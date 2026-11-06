import express from 'express';
import { workspaceContext, accountPayload, ensurePersonalWorkspace, installWorkspaceRoutes } from './workspaces.js';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { User, Website, WorkLog, MonthlyAllocation, AuditLog } from './models.js';
import { websiteInput, logInput, allocationInput, credentials, bootstrapInput, passwordChangeInput, forgotPasswordInput, resetPasswordInput, id, date } from './validation.js';
import { reportRows, csvCell, duration } from '../shared/tracking.js';
import { sendConfiguredEmail, recoveryEmail, passwordChangedEmail } from './email.js';

const EXPORT_HEADERS = ['Date', 'Website Name', 'Website URL', 'Work Description', 'Work Category', 'Hours', 'Minutes', 'Total Time', 'Notes', 'Created At'];
const EXPORT_WIDTHS = [14, 26, 34, 48, 20, 10, 10, 18, 42, 26];
const activeAccount = { $or: [{ status: 'active' }, { status: { $exists: false } }] };

function exportRows(logs, websites) {
  const byId = new Map(websites.map(website => [String(website._id), website]));
  return logs.map(log => {
    const website = byId.get(String(log.websiteId));
    const totalMinutes = log.totalMinutes ?? log.hours * 60 + log.minutes;
    return [log.date, website?.name || 'Deleted website', website?.url || '', log.description, log.category, log.hours, log.minutes, duration(totalMinutes), log.notes || '', log.createdAt ? new Date(log.createdAt).toISOString() : ''];
  });
}

function safeFilename(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'Website';
}

function safeWorksheetName(value, used) {
  const forbidden = new Set(['\\', '/', '?', '*', '[', ']', ':']);
  let base = [...String(value)].map(character => forbidden.has(character) || character.charCodeAt(0) < 32 ? '-' : character).join('').trim().slice(0, 31).replace(/^'+|'+$/g, '') || 'Website';
  if (base.toLowerCase() === 'history') base = 'Website History';
  let name = base, suffix = 2;
  while (used.has(name.toLowerCase())) {
    const tail = ` (${suffix++})`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function addExportWorksheet(workbook, name, rows, used) {
  const sheet = workbook.addWorksheet(safeWorksheetName(name, used));
  sheet.columns = EXPORT_WIDTHS.map(width => ({ width }));
  sheet.addRow(EXPORT_HEADERS);
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2EA' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_HEADERS.length } };
  return sheet;
}

function sendExportCsv(res, rows, filename) {
  const csv = [EXPORT_HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  return res.attachment(filename).set('Content-Type', 'text/csv; charset=utf-8').send('\uFEFF' + csv);
}

function addSummaryWorksheet(workbook, websites, logsByWebsite, used) {
  const sheet = workbook.addWorksheet(safeWorksheetName('Summary', used));
  sheet.columns = [{ width: 28 }, { width: 38 }, { width: 16 }, { width: 18 }];
  sheet.addRow(['Website Name', 'Website URL', 'Work Entries', 'Total Time']);
  websites.forEach(website => {
    const logs = logsByWebsite.get(String(website._id)) || [];
    sheet.addRow([website.name, website.url, logs.length, duration(logs.reduce((sum, log) => sum + (log.totalMinutes ?? log.hours * 60 + log.minutes), 0))]);
  });
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2EA' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
}

function createCombinedWorkbook(websites, logs, logsByWebsite) {
  const workbook = new ExcelJS.Workbook();
  const used = new Set();
  addSummaryWorksheet(workbook, websites, logsByWebsite, used);
  websites.forEach(website => addExportWorksheet(workbook, website.name, exportRows(logsByWebsite.get(String(website._id)) || [], websites), used));
  addExportWorksheet(workbook, 'All Work Logs', exportRows(logs, websites), used);
  return workbook;
}
export function createApp({ secret, production = false, sendMail = sendConfiguredEmail, appUrl = process.env.APP_URL || '' } = {}) {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = express();
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: '1mb' }), cookieParser());
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'Tempo') return res.status(403).json({ error: 'Missing request verification header' });
    next();
  });
  const cookie = { httpOnly: true, secure: production, sameSite: 'strict', maxAge: 7 * 86400000, path: '/' };
  const signIn = async (res, user) => { user.lastLogin = new Date(); await user.save(); res.cookie('tempo_session', jwt.sign({ sub: String(user._id), sv: user.sessionVersion || 0 }, secret, { expiresIn: '7d', algorithm: 'HS256' }), cookie); return res.json(accountPayload(user, await workspaceContext(user))); };
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
  const resetRequestLimiter = rateLimit({ windowMs: 15 * 60000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'If an active account matches that email, a recovery code will be sent.' } });
  const resetVerifyLimiter = rateLimit({ windowMs: 15 * 60000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'The recovery code is invalid or expired.' } });
  const ownerOnly = (req, res, next) => req.membership?.role === 'owner' && String(req.user._id) === String(req.workspace.ownerId) ? next() : res.status(403).json({ error: 'Only the workspace owner can manage users, backups and audit logs.' });
  const requireRoles = (...roles) => (req, res, next) => roles.includes(req.membership?.role) || (req.membership?.role === 'owner' && roles.includes('admin')) ? next() : res.status(403).json({ error: 'Your role does not allow this action.' });
  const audit = async (req, action, resourceType, resourceId = '', details = {}) => AuditLog.create({ workspaceId: req.workspaceId, userId: req.user._id, userName: req.user.name, userRole: req.membership?.role === 'owner' ? 'admin' : req.membership.role, action, resourceType, resourceId: resourceId ? String(resourceId) : '', details });
  const invalidReset = res => res.status(400).json({ error: 'The recovery code is invalid or expired.' });
  app.get('/api/auth/setup-status', async (_req, res) => res.json({ registrationEnabled: true, needsOwner: false, bootstrapEnabled: false }));
  app.post('/api/auth/register', limiter, async (req, res) => {
    const value = bootstrapInput.parse(req.body);
    const user = await User.create({ name: value.name, email: value.email, passwordHash: await bcrypt.hash(value.password, 12), status: 'active' });
    await ensurePersonalWorkspace(user);
    return signIn(res, user);
  });
  app.post('/api/auth/bootstrap', limiter, (_req, res) => res.status(410).json({ error: 'Register an account to create your personal workspace.' }));
  app.post('/api/auth/login', limiter, async (req, res) => {
    const value = credentials.parse(req.body);
    const user = await User.findOne({ $or: [{ email: value.email }, { username: value.email }] }).select('+passwordHash +sessionVersion');
    if (!user || user.status !== 'active' || !await bcrypt.compare(value.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect' });
    return signIn(res, user);
  });
  app.post('/api/auth/logout', async (req, res) => {
    let token;
    try { token = jwt.verify(req.cookies.tempo_session, secret, { algorithms: ['HS256'] }); } catch { /* Already signed out. */ }
    if (token) await User.updateOne({ _id: token.sub, sessionVersion: (token.sv ?? 0) === 0 ? { $in: [0, null] } : token.sv }, { $inc: { sessionVersion: 1 } });
    res.clearCookie('tempo_session', { ...cookie, maxAge: undefined });
    res.json({ ok: true });
  });
  app.post('/api/auth/forgot-password', resetRequestLimiter, async (req, res) => {
    const { email } = forgotPasswordInput.parse(req.body);
    const generic = { message: 'If an active account matches that email, a recovery code will be sent.' };
    const user = await User.findOne({ email, ...activeAccount }).select('+resetCodeHash +resetCodeExpiry +resetAttempts +resetRequestCount +resetRequestWindowStart');
    if (!user) return res.json(generic);
    const now = new Date(), windowAge = user.resetRequestWindowStart ? now - user.resetRequestWindowStart : Infinity;
    if (windowAge >= 15 * 60 * 1000) { user.resetRequestWindowStart = now; user.resetRequestCount = 0; }
    if (user.resetRequestCount >= 3) return res.json(generic);
    const code = String(randomInt(10000000, 100000000));
    user.resetCodeHash = createHash('sha256').update(code).digest('hex');
    user.resetCodeExpiry = new Date(now.getTime() + 10 * 60 * 1000);
    user.resetAttempts = 0;
    user.resetRequestCount = (user.resetRequestCount || 0) + 1;
    await user.save();
    try { await sendMail({ to: user.email, ...recoveryEmail({ name: user.name, code }) }); }
    catch {
      await User.updateOne({ _id: user._id, resetCodeHash: user.resetCodeHash }, { $unset: { resetCodeHash: 1, resetCodeExpiry: 1 } });
      console.error('Password recovery email delivery failed. Check SMTP configuration.');
    }
    return res.json(generic);
  });
  app.post('/api/auth/reset-password', resetVerifyLimiter, async (req, res) => {
    const value = resetPasswordInput.parse(req.body);
    const user = await User.findOne({ email: value.email, ...activeAccount }).select('+passwordHash +resetCodeHash +resetCodeExpiry +resetAttempts +sessionVersion');
    if (!user || !user.resetCodeHash || !user.resetCodeExpiry || user.resetCodeExpiry <= new Date() || user.resetAttempts >= 5) return invalidReset(res);
    const candidate = Buffer.from(createHash('sha256').update(value.code).digest('hex'), 'hex');
    const expected = Buffer.from(user.resetCodeHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await User.updateOne({ _id: user._id, resetCodeHash: user.resetCodeHash }, { $inc: { resetAttempts: 1 } });
      return invalidReset(res);
    }
    const passwordHash = await bcrypt.hash(value.password, 12);
    // Consume this exact code once, even when requests overlap during hashing.
    const changed = await User.findOneAndUpdate({ _id: user._id, ...activeAccount, resetCodeHash: user.resetCodeHash, resetCodeExpiry: { $gt: new Date() }, resetAttempts: { $lt: 5 }, sessionVersion: (user.sessionVersion || 0) === 0 ? { $in: [0, null] } : user.sessionVersion }, {
      $set: { passwordHash, mustChangePassword: false, resetAttempts: 0, resetRequestCount: 0 },
      $inc: { sessionVersion: 1 },
      $unset: { resetCodeHash: 1, resetCodeExpiry: 1, resetRequestWindowStart: 1 },
    });
    if (!changed) return invalidReset(res);
    sendMail({ to: user.email, ...passwordChangedEmail({ name: user.name }) }).catch(() => console.error('Password confirmation email delivery failed. Check SMTP configuration.'));
    return res.json({ message: 'Password updated. Sign in with your new password.' });
  });
  app.use('/api', async (req, res, next) => {
    let token;
    try { token = jwt.verify(req.cookies.tempo_session, secret, { algorithms: ['HS256'] }); }
    catch { res.clearCookie('tempo_session', { ...cookie, maxAge: undefined }); return res.status(401).json({ error: 'Please sign in to continue' }); }
    const user = await User.findById(token.sub).select('+sessionVersion');
    if (!user || user.status !== 'active' || (token.sv ?? 0) !== (user.sessionVersion || 0)) return res.status(401).json({ error: 'Please sign in to continue' });
    req.user = user;
    const pathname = req.originalUrl.split('?')[0];
    if (user.mustChangePassword && !['/api/auth/me', '/api/auth/change-password'].includes(pathname)) return res.status(403).json({ error: 'Change your temporary password to continue.' });
    // Account/invitation/list/switch endpoints remain usable after a membership is removed.
    const accountRoute = pathname.startsWith('/api/auth/') || pathname.startsWith('/api/invitations/') || pathname === '/api/workspaces' || /^\/api\/workspaces\/[^/]+\/select$/.test(pathname);
    const context = await workspaceContext(user, accountRoute ? undefined : req.get('X-Workspace-Id'));
    req.workspace = context.workspace; req.membership = context.membership;
    req.workspaceId = context.workspace._id; req.scope = { workspaceId: req.workspaceId };
    await context.membership.updateOne({ $set: { lastActive: new Date() } });
    return next();
  });
  app.post('/api/auth/change-password', limiter, async (req, res) => {
    const value = passwordChangeInput.parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash +sessionVersion');
    if (!user.mustChangePassword && (!value.currentPassword || !await bcrypt.compare(value.currentPassword, user.passwordHash))) return res.status(401).json({ error: 'Current password is incorrect.' });
    user.passwordHash = await bcrypt.hash(value.newPassword, 12);
    user.mustChangePassword = false;
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.resetCodeHash = undefined;
    user.resetCodeExpiry = undefined;
    await user.save();
    sendMail({ to: user.email, ...passwordChangedEmail({ name: user.name }) }).catch(error => console.error('Password confirmation email delivery failed:', error.message));
    return signIn(res, user);
  });
  app.post('/api/auth/claim-owner', (_req, res) => res.status(410).json({ error: 'Your personal workspace already has you as its owner.' }));
  app.get('/api/auth/me', async (req, res) => res.json(accountPayload(req.user, await workspaceContext(req.user))));
  const invitationLimiter = rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many invitation requests. Try again later.' } });
  installWorkspaceRoutes(app, { sendMail, appUrl, ownerOnly, audit, invitationLimiter });
  // Membership owners must never reset or delete another person's login identity.
  app.use('/api/users', ownerOnly, (_req, res) => res.status(410).json({ error: 'Use Workspace Members to invite and manage memberships. Accounts are independent.' }));
  app.get('/api/audit-logs', ownerOnly, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const logs = await AuditLog.find(req.scope).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs.map(({ _id, __v, ...log }) => ({ ...log, id: String(_id) })));
  });
  app.get('/api/data', async (req, res) => {
    const [websites, logs, allocations] = await Promise.all([Website.find(req.scope).sort({ createdAt: -1 }), WorkLog.find(req.scope).sort({ date: -1, createdAt: -1 }), MonthlyAllocation.find(req.scope)]);
    res.json({ websites, logs, allocations, workspaceId: String(req.workspaceId), workspaceName: req.workspace.name, role: req.membership.role });
  });
  const findWebsite = async (req, websiteId) => { const w = await Website.findOne({ _id: id.parse(websiteId), ...req.scope }); if (!w) throw Object.assign(new Error('Website not found'), { status: 404 }); return w; };
  app.post('/api/websites', requireRoles('admin', 'editor'), async (req, res) => { const website = await Website.create({ ...websiteInput.parse(req.body), workspaceId: req.workspaceId, userId: req.user._id }); await audit(req, 'website.created', 'website', website._id, { name: website.name }); res.status(201).json(website); });
  app.put('/api/websites/:id', requireRoles('admin', 'editor'), async (req, res) => { const value = websiteInput.parse(req.body); const website = await findWebsite(req, req.params.id); if (await WorkLog.exists({ ...req.scope, websiteId: website._id, date: { $lt: value.startDate } })) return res.status(409).json({ error: 'Project start date cannot be after existing work logs.' }); Object.assign(website, value); await website.save(); await audit(req, 'website.updated', 'website', website._id, { name: website.name }); res.json(website); });
  app.delete('/api/websites/:id', requireRoles('admin', 'editor'), async (req, res) => { const website = await findWebsite(req, req.params.id); const query = { websiteId: website._id, ...req.scope }; await WorkLog.deleteMany(query); await MonthlyAllocation.deleteMany(query); await website.deleteOne(); await audit(req, 'website.deleted', 'website', website._id, { name: website.name }); res.json({ ok: true }); });
  app.put('/api/allocations', requireRoles('admin', 'editor'), async (req, res) => { const value = allocationInput.parse(req.body); await findWebsite(req, value.websiteId); const query = { ...req.scope, websiteId: value.websiteId, year: value.year, month: value.month }; const allocation = await MonthlyAllocation.findOneAndUpdate(query, { $set: { allocatedHours: value.allocatedHours }, $setOnInsert: { workspaceId: req.workspaceId, userId: req.user._id } }, { upsert: true, new: true, runValidators: true }); await audit(req, 'allocation.updated', 'allocation', allocation._id, { websiteId: value.websiteId, year: value.year, month: value.month }); res.json(allocation); });
  app.delete('/api/allocations/:id', requireRoles('admin', 'editor'), async (req, res) => { const result = await MonthlyAllocation.deleteOne({ _id: id.parse(req.params.id), ...req.scope }); if (!result.deletedCount) return res.status(404).json({ error: 'Allocation not found' }); await audit(req, 'allocation.deleted', 'allocation', req.params.id, {}); res.json({ ok: true }); });
  app.post('/api/logs', requireRoles('admin', 'editor'), async (req, res) => { const value = logInput.parse(req.body); const website = await findWebsite(req, value.websiteId); if (value.date < website.startDate) return res.status(400).json({ error: 'Work date must be on or after the project start date' }); const log = await WorkLog.create({ ...value, totalMinutes: value.hours * 60 + value.minutes, workspaceId: req.workspaceId, userId: req.user._id }); await audit(req, 'worklog.created', 'worklog', log._id, { websiteId: value.websiteId, date: value.date }); res.status(201).json(log); });
  app.put('/api/logs/:id', requireRoles('admin', 'editor'), async (req, res) => { const value = logInput.parse(req.body); const website = await findWebsite(req, value.websiteId); if (value.date < website.startDate) return res.status(400).json({ error: 'Work date must be on or after the project start date' }); const log = await WorkLog.findOneAndUpdate({ _id: id.parse(req.params.id), ...req.scope }, { ...value, totalMinutes: value.hours * 60 + value.minutes }, { new: true, runValidators: true }); if (!log) return res.status(404).json({ error: 'Work log not found' }); await audit(req, 'worklog.updated', 'worklog', log._id, { websiteId: value.websiteId, date: value.date }); res.json(log); });
  app.delete('/api/logs/:id', requireRoles('admin', 'editor'), async (req, res) => { const log = await WorkLog.findOneAndDelete({ _id: id.parse(req.params.id), ...req.scope }); if (!log) return res.status(404).json({ error: 'Work log not found' }); await audit(req, 'worklog.deleted', 'worklog', log._id, { websiteId: String(log.websiteId), date: log.date }); res.json({ ok: true }); });
  app.get('/api/backup', ownerOnly, async (req, res) => { const [websites, logs, allocations] = await Promise.all([Website.find(req.scope), WorkLog.find(req.scope), MonthlyAllocation.find(req.scope)]); res.attachment('tempo-backup.json').json({ version: 1, exportedAt: new Date().toISOString(), websites, logs, allocations }); });
  app.get('/api/websites/:id/export/:format', async (req, res) => {
    if (!['csv', 'xlsx'].includes(req.params.format)) return res.status(400).json({ error: 'Choose CSV or Excel' });
    const website = await findWebsite(req, req.params.id);
    const logs = await WorkLog.find({ websiteId: website._id, ...req.scope }).sort({ date: 1, createdAt: 1, _id: 1 });
    const rows = exportRows(logs, [website]);
    const filename = `${safeFilename(website.name)}-Work-Report.${req.params.format}`;
    if (req.params.format === 'csv') return sendExportCsv(res, rows, filename);
    const workbook = new ExcelJS.Workbook();
    addExportWorksheet(workbook, 'Work History', rows, new Set());
    res.attachment(filename).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
  });
  app.get('/api/export/all/:format', async (req, res) => {
    if (!['csv', 'xlsx'].includes(req.params.format)) return res.status(400).json({ error: 'Choose CSV or Excel' });
    const [websites, logs] = await Promise.all([
      Website.find(req.scope).sort({ name: 1, _id: 1 }),
      WorkLog.find(req.scope).sort({ date: 1, createdAt: 1, _id: 1 }),
    ]);
    const rows = exportRows(logs, websites);
    if (req.params.format === 'csv') return sendExportCsv(res, rows, `All-Projects-Work-Report.csv`);
    const logsByWebsite = new Map(websites.map(website => [String(website._id), []]));
    logs.forEach(log => logsByWebsite.get(String(log.websiteId))?.push(log));
    const workbook = createCombinedWorkbook(websites, logs, logsByWebsite);
    res.attachment('All-Projects-Work-Report.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
  });
  app.get('/api/export/:format', async (req, res) => {
    if (!['csv', 'xlsx'].includes(req.params.format)) return res.status(400).json({ error: 'Choose CSV or Excel' });
    const filters = Object.fromEntries(['websiteId', 'category', 'from', 'to'].map(k => [k, typeof req.query[k] === 'string' ? req.query[k] : '']));
    if (filters.from) date.parse(filters.from); if (filters.to) date.parse(filters.to); if (filters.websiteId) id.parse(filters.websiteId);
    const [logs, websites] = await Promise.all([WorkLog.find(req.scope), Website.find(req.scope)]);
    const names = Object.fromEntries(websites.map(w => [String(w._id), w.name]));
    const rows = reportRows(logs.map(l => l.toJSON()), filters).map(l => [l.date, names[l.websiteId] || 'Deleted website', l.description, l.category, l.hours, l.minutes, l.totalMinutes, l.notes]);
    const headers = ['Date', 'Website', 'Description', 'Category', 'Hours', 'Minutes', 'Total minutes', 'Notes'];
    if (req.params.format === 'csv') return res.type('text/csv').attachment('tempo-work-report.csv').send('\uFEFF' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Work report'); sheet.addRow(headers); sheet.addRows(rows); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((c, i) => { c.width = [14, 25, 55, 22, 10, 10, 16, 50][i]; });
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('tempo-work-report.xlsx'); await workbook.xlsx.write(res); res.end();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((err, _req, res, _next) => { if (err.name === 'ZodError') return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'Entry'}: ${i.message}`).join('; ') }); if (err.code === 11000) return res.status(409).json({ error: 'An account, membership or pending invitation already exists' }); if (err.status) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
  return app;
}
