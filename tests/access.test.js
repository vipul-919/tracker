import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../server/app.js';
import { User, Website, WorkLog, MonthlyAllocation, AuditLog } from '../server/models.js';

let mongo, app, owner, editor, viewer, outsider, legacy, site, member, externalSite, externalUser;
const header = ['X-Requested-With', 'Tempo'];
const token = 'isolated-owner-upgrade-token';
const password = 'Temporary-Access-Password-1';
const website = { name: 'Owner history', url: 'https://example.test', description: '', defaultMonthlyHours: 12, startDate: '2020-01-01', status: 'Active' };
const log = websiteId => ({ websiteId, date: '2026-01-01', description: 'Shared work', category: 'Development', hours: 1, minutes: 0 });
before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { downloadDir: '.data/mongodb-binaries' } });
  await mongoose.connect(mongo.getUri());
  app = createApp({ secret: 'isolated-access-test-secret-more-than-32-characters', bootstrapToken: token, sendMail: async () => { throw new Error('SMTP unavailable'); } });
  owner = request.agent(app); editor = request.agent(app); viewer = request.agent(app); outsider = request.agent(app);
  legacy = await User.create({ name: 'Existing owner', email: 'original@example.test', passwordHash: await bcrypt.hash(password, 4) });
  site = await Website.create({ ...website, userId: legacy._id });
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('existing owner upgrade verifies a server token and preserves password and historical data', async () => {
  await owner.post('/api/auth/login').set(...header).send({ email: legacy.email, password }).expect(200);
  await owner.get('/api/users').expect(403);
  await owner.get('/api/data').expect(200).expect(({ body }) => assert.equal(body.websites[0].name, website.name));
  await request(app).post('/api/auth/claim-owner').set(...header).expect(401);
  await owner.post('/api/auth/claim-owner').set(...header).set('X-Admin-Bootstrap-Token', 'invalid').expect(403);
  await owner.post('/api/auth/claim-owner').set(...header).set('X-Admin-Bootstrap-Token', token).expect(200).expect(({ body }) => {
    assert.equal(body.isPrimaryAdmin, true); assert.equal(body.workspaceId, String(legacy._id)); assert.equal(body.passwordHash, undefined);
  });
  await owner.post('/api/auth/claim-owner').set(...header).set('X-Admin-Bootstrap-Token', token).expect(409);
  await request(app).post('/api/auth/login').set(...header).send({ email: legacy.email, password }).expect(200);
  await owner.get('/api/data').expect(200).expect(({ body }) => assert.equal(body.websites[0].id, String(site._id)));
  assert.equal(String((await Website.findById(site._id)).workspaceId), String(legacy._id));
});

test('manual account creation, optional failed email, username login and forced first password change', async () => {
  const result = await owner.post('/api/users').set(...header).send({ name: 'Manual editor', email: 'editor@example.test', username: 'manual-editor', password, role: 'editor', status: 'active' }).expect(201);
  member = result.body;
  assert.equal(member.workspaceId, String(legacy._id)); assert.equal(member.invitationSent, false);
  assert.equal(member.passwordHash, undefined); assert.equal(member.password, undefined);
  assert.equal(result.headers['cache-control'], 'no-store');
  const hash = (await User.findById(member.id).select('+passwordHash')).passwordHash;
  assert.notEqual(hash, password); assert.equal(await bcrypt.compare(password, hash), true);
  await owner.post('/api/users').set(...header).send({ name: 'Duplicate', email: 'EDITOR@example.test', password, role: 'viewer', status: 'active' }).expect(409);
  await owner.post('/api/users').set(...header).send({ name: 'Not another owner', email: 'admin@example.test', password, role: 'admin', status: 'active' }).expect(400);
  await owner.post('/api/users').set(...header).send({ name: 'Invited viewer', email: 'viewer@example.test', password, role: 'viewer', status: 'active', sendInvitation: true }).expect(201).expect(({ body }) => assert.equal(body.invitationSent, false));
  await editor.post('/api/auth/login').set(...header).send({ email: 'MANUAL-EDITOR', password }).expect(200);
  await editor.get('/api/data').expect(403);
  await editor.post('/api/auth/change-password').set(...header).send({ newPassword: 'Editor-Changed-Password-2' }).expect(200);
  await viewer.post('/api/auth/login').set(...header).send({ email: 'viewer@example.test', password }).expect(200);
  await viewer.post('/api/auth/change-password').set(...header).send({ newPassword: 'Viewer-Changed-Password-2' }).expect(200);
  await editor.get('/api/data').expect(200).expect(({ body }) => assert.equal(body.websites[0].id, String(site._id)));
  await editor.get('/api/users').expect(403); await viewer.get('/api/users').expect(403);
  await editor.put('/api/users/' + legacy._id).set(...header).send({ role: 'viewer' }).expect(403);
  await owner.put('/api/users/' + member.id).set(...header).send({ role: 'admin' }).expect(400);
  await owner.put('/api/users/' + legacy._id).set(...header).send({ role: 'viewer' }).expect(403);
  await owner.delete('/api/users/' + legacy._id).set(...header).expect(403);
});

test('workspace boundary covers reads, direct writes, allocations, backups, users, audit and exports', async () => {
  externalUser = await User.create({ name: 'Other workspace', email: 'outside@example.test', passwordHash: await bcrypt.hash(password, 4), role: 'editor' });
  externalUser.workspaceId = externalUser._id; await externalUser.save();
  await outsider.post('/api/auth/login').set(...header).send({ email: externalUser.email, password }).expect(200);
  externalSite = (await outsider.post('/api/websites').set(...header).send({ ...website, name: 'Private foreign site' }).expect(201)).body;
  const foreignLog = (await outsider.post('/api/logs').set(...header).send(log(externalSite.id)).expect(201)).body;
  const foreignAllocation = (await outsider.put('/api/allocations').set(...header).send({ websiteId: externalSite.id, month: 1, year: 2026, allocatedHours: 9 }).expect(200)).body;
  for (const agent of [owner, editor, viewer]) {
    const data = (await agent.get('/api/data').expect(200)).body;
    assert.ok(data.websites.every(w => w.id !== externalSite.id)); assert.ok(data.logs.every(l => l.id !== foreignLog.id));
    await agent.get('/api/websites/' + externalSite.id + '/export/csv').expect(404);
    const csv = await agent.get('/api/export/all/csv').expect(200); assert.doesNotMatch(csv.text, /Private foreign site/);
    const filtered = await agent.get('/api/export/csv?websiteId=' + externalSite.id).expect(200); assert.doesNotMatch(filtered.text, /Shared work/);
  }
  await editor.put('/api/websites/' + externalSite.id).set(...header).send(website).expect(404);
  await editor.delete('/api/websites/' + externalSite.id).set(...header).expect(404);
  await editor.post('/api/logs').set(...header).send(log(externalSite.id)).expect(404);
  await editor.put('/api/logs/' + foreignLog.id).set(...header).send(log(String(site._id))).expect(404);
  await editor.delete('/api/logs/' + foreignLog.id).set(...header).expect(404);
  await editor.put('/api/allocations').set(...header).send({ websiteId: externalSite.id, month: 1, year: 2026, allocatedHours: 1 }).expect(404);
  await editor.delete('/api/allocations/' + foreignAllocation.id).set(...header).expect(404);
  await owner.put('/api/users/' + externalUser._id).set(...header).send({ name: 'Stolen' }).expect(404);
  await owner.delete('/api/users/' + externalUser._id).set(...header).expect(404);
  await owner.post('/api/users/' + externalUser._id + '/reset-password').set(...header).expect(404);
  const users = (await owner.get('/api/users').expect(200)).body; assert.ok(users.every(u => u.email !== externalUser.email));
  const audit = (await owner.get('/api/audit-logs').expect(200)).body; assert.ok(audit.every(a => a.userName !== externalUser.name));
  const backup = (await owner.get('/api/backup').expect(200)).body; assert.ok(backup.websites.every(w => w.id !== externalSite.id));
  for (const model of [Website, WorkLog, MonthlyAllocation, AuditLog]) assert.ok(await model.countDocuments({ workspaceId: externalUser._id }));
  const sharedLog = await editor.post('/api/logs').set(...header).send(log(String(site._id))).expect(201);
  assert.equal(sharedLog.body.workspaceId, String(legacy._id));
  await viewer.get('/api/data').expect(200).expect(({ body }) => assert.ok(body.logs.some(l => l.id === sharedLog.body.id)));
  await viewer.delete('/api/logs/' + sharedLog.body.id).set(...header).expect(403);
});

test('manual reset invalidates old recovery codes and sessions; logout rejects copied cookies', async () => {
  const user = await User.findById(member.id).select('+resetCodeHash +resetCodeExpiry');
  const { createHash } = await import('node:crypto');
  user.resetCodeHash = createHash('sha256').update('12345678').digest('hex'); user.resetCodeExpiry = new Date(Date.now() + 600000); await user.save();
  const reset = await owner.post('/api/users/' + member.id + '/reset-password').set(...header).expect(200);
  assert.equal(reset.headers['cache-control'], 'no-store'); assert.ok(reset.body.temporaryPassword); assert.equal(reset.body.invitationSent, false);
  await editor.get('/api/data').expect(401);
  await request(app).post('/api/auth/reset-password').set(...header).send({ email: member.email, code: '12345678', password: 'Invalid-Stale-Password-2' }).expect(400);
  await editor.post('/api/auth/login').set(...header).send({ email: member.email, password: reset.body.temporaryPassword }).expect(200);
  const changed = await editor.post('/api/auth/change-password').set(...header).send({ newPassword: 'Editor-Changed-Password-3' }).expect(200);
  const cookie = changed.headers['set-cookie'][0].split(';')[0];
  await editor.post('/api/auth/logout').set(...header).expect(200);
  await request(app).get('/api/data').set('Cookie', cookie).expect(401);
  await owner.get('/api/users').expect(200).expect(({ body }) => assert.ok(body.every(u => u.temporaryPassword === undefined && u.passwordHash === undefined)));
});

test('recovery is consumed once under concurrency and start-date edits preserve history', async () => {
  const { createHash } = await import('node:crypto');
  const user = await User.findById(member.id).select('+resetCodeHash +resetCodeExpiry');
  user.resetCodeHash = createHash('sha256').update('87654321').digest('hex');
  user.resetCodeExpiry = new Date(Date.now() + 600000); await user.save();
  const attempts = await Promise.all(['Concurrent-Password-A', 'Concurrent-Password-B'].map(newPassword => request(app).post('/api/auth/reset-password').set(...header).send({ email: member.email, code: '87654321', password: newPassword })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400]);
  await owner.put('/api/websites/' + site._id).set(...header).send({ ...website, startDate: '2026-02-01' }).expect(409);
  assert.equal((await Website.findById(site._id)).startDate, website.startDate);
  const workbookResponse = await viewer.get('/api/export/all/xlsx').buffer(true).parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(workbookResponse.body);
  assert.ok(workbook.worksheets.every(sheet => sheet.name !== externalSite.name));
});
