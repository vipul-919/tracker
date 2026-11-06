import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { User, Website, WorkLog, MonthlyAllocation } from './models.js';
import { websiteInput, logInput, allocationInput, credentials, registration, id, date } from './validation.js';
import { reportRows, csvCell, duration } from '../shared/tracking.js';

const EXPORT_HEADERS = ['Date', 'Website Name', 'Website URL', 'Work Description', 'Work Category', 'Hours', 'Minutes', 'Total Time', 'Notes', 'Created At'];
const EXPORT_WIDTHS = [14, 26, 34, 48, 20, 10, 10, 18, 42, 26];

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
  const base = [...String(value)].map(character => forbidden.has(character) ? '-' : character).join('').trim().slice(0, 31) || 'Website';
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
export function createApp({ secret, production = false } = {}) {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = express();
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: '1mb' }), cookieParser());
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'Tempo') return res.status(403).json({ error: 'Missing request verification header' });
    next();
  });
  const cookie = { httpOnly: true, secure: production, sameSite: 'strict', maxAge: 7 * 86400000, path: '/' };
  const signIn = (res, user) => { res.cookie('tempo_session', jwt.sign({ sub: String(user._id) }, secret, { expiresIn: '7d', algorithm: 'HS256' }), cookie); return res.json(user); };
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
  app.post('/api/auth/register', limiter, async (req, res) => { const v = registration.parse(req.body); const passwordHash = await bcrypt.hash(v.password, 12); const user = await User.create({ name: v.name, email: v.email, passwordHash }); signIn(res, user); });
  app.post('/api/auth/login', limiter, async (req, res) => { const v = credentials.parse(req.body); const user = await User.findOne({ email: v.email }); if (!user || !await bcrypt.compare(v.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect' }); signIn(res, user); });
  app.post('/api/auth/logout', (_req, res) => { res.clearCookie('tempo_session', { ...cookie, maxAge: undefined }); res.json({ ok: true }); });
  app.use('/api', async (req, res, next) => { try { const token = jwt.verify(req.cookies.tempo_session, secret, { algorithms: ['HS256'] }); req.user = await User.findById(token.sub); if (!req.user) throw new Error(); next(); } catch { res.status(401).json({ error: 'Please sign in to continue' }); } });
  app.get('/api/auth/me', (req, res) => res.json(req.user));
  app.get('/api/data', async (req, res) => { const q = { userId: req.user._id }; const [websites, logs, allocations] = await Promise.all([Website.find(q).sort({ createdAt: -1 }), WorkLog.find(q).sort({ date: -1, createdAt: -1 }), MonthlyAllocation.find(q)]); res.json({ websites, logs, allocations }); });
  const findWebsite = async (req, websiteId) => { const w = await Website.findOne({ _id: id.parse(websiteId), userId: req.user._id }); if (!w) throw Object.assign(new Error('Website not found'), { status: 404 }); return w; };
  app.post('/api/websites', async (req, res) => res.status(201).json(await Website.create({ ...websiteInput.parse(req.body), userId: req.user._id })));
  app.put('/api/websites/:id', async (req, res) => { const v = websiteInput.parse(req.body); const w = await findWebsite(req, req.params.id); Object.assign(w, v); await w.save(); res.json(w); });
  app.delete('/api/websites/:id', async (req, res) => { const w = await findWebsite(req, req.params.id); const q = { userId: req.user._id, websiteId: w._id }; await WorkLog.deleteMany(q); await MonthlyAllocation.deleteMany(q); await w.deleteOne(); res.json({ ok: true }); });
  app.put('/api/allocations', async (req, res) => { const v = allocationInput.parse(req.body); await findWebsite(req, v.websiteId); const q = { userId: req.user._id, websiteId: v.websiteId, year: v.year, month: v.month }; res.json(await MonthlyAllocation.findOneAndUpdate(q, { $set: { allocatedHours: v.allocatedHours } }, { upsert: true, new: true, runValidators: true })); });
  app.delete('/api/allocations/:id', async (req, res) => { const result = await MonthlyAllocation.deleteOne({ _id: id.parse(req.params.id), userId: req.user._id }); if (!result.deletedCount) return res.status(404).json({ error: 'Allocation not found' }); res.json({ ok: true }); });
  app.post('/api/logs', async (req, res) => { const v = logInput.parse(req.body); const w = await findWebsite(req, v.websiteId); if (v.date < w.startDate) return res.status(400).json({ error: 'Work date must be on or after the project start date' }); res.status(201).json(await WorkLog.create({ ...v, totalMinutes: v.hours * 60 + v.minutes, userId: req.user._id })); });
  app.put('/api/logs/:id', async (req, res) => { const v = logInput.parse(req.body); const w = await findWebsite(req, v.websiteId); if (v.date < w.startDate) return res.status(400).json({ error: 'Work date must be on or after the project start date' }); const l = await WorkLog.findOneAndUpdate({ _id: id.parse(req.params.id), userId: req.user._id }, { ...v, totalMinutes: v.hours * 60 + v.minutes }, { new: true, runValidators: true }); if (!l) return res.status(404).json({ error: 'Work log not found' }); res.json(l); });
  app.delete('/api/logs/:id', async (req, res) => { const r = await WorkLog.deleteOne({ _id: id.parse(req.params.id), userId: req.user._id }); if (!r.deletedCount) return res.status(404).json({ error: 'Work log not found' }); res.json({ ok: true }); });
  app.get('/api/backup', async (req, res) => { const q = { userId: req.user._id }; const [websites, logs, allocations] = await Promise.all([Website.find(q), WorkLog.find(q), MonthlyAllocation.find(q)]); res.attachment('tempo-backup.json').json({ version: 1, exportedAt: new Date().toISOString(), websites, logs, allocations }); });
  app.get('/api/websites/:id/export/:format', async (req, res) => {
    if (!['csv', 'xlsx'].includes(req.params.format)) return res.status(400).json({ error: 'Choose CSV or Excel' });
    const website = await findWebsite(req, req.params.id);
    const logs = await WorkLog.find({ userId: req.user._id, websiteId: website._id }).sort({ date: 1, createdAt: 1, _id: 1 });
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
    const query = { userId: req.user._id };
    const [websites, logs] = await Promise.all([
      Website.find(query).sort({ name: 1, _id: 1 }),
      WorkLog.find(query).sort({ date: 1, createdAt: 1, _id: 1 }),
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
    const q = { userId: req.user._id };
    const [logs, websites] = await Promise.all([WorkLog.find(q), Website.find(q)]);
    const names = Object.fromEntries(websites.map(w => [String(w._id), w.name]));
    const rows = reportRows(logs.map(l => l.toJSON()), filters).map(l => [l.date, names[l.websiteId] || 'Deleted website', l.description, l.category, l.hours, l.minutes, l.totalMinutes, l.notes]);
    const headers = ['Date', 'Website', 'Description', 'Category', 'Hours', 'Minutes', 'Total minutes', 'Notes'];
    if (req.params.format === 'csv') return res.type('text/csv').attachment('tempo-work-report.csv').send('\uFEFF' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Work report'); sheet.addRow(headers); sheet.addRows(rows); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((c, i) => { c.width = [14, 25, 55, 22, 10, 10, 16, 50][i]; });
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('tempo-work-report.xlsx'); await workbook.xlsx.write(res); res.end();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((err, _req, res, _next) => { if (err.name === 'ZodError') return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'Entry'}: ${i.message}`).join('; ') }); if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists' }); if (err.status) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
  return app;
}
