import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../server/app.js';
import { User } from '../server/models.js';
let mongo, app, owner, editor, other, websiteId, logId, allocationId;
const header = ['X-Requested-With', 'Tempo'];
const website = { name: 'Test website', url: 'https://example.com', description: 'Testing', defaultMonthlyHours: 12, startDate: '2026-01-01', status: 'Active' };
const emailMessages = [];
const bootstrapToken = 'test-owner-bootstrap-token-longer-than-32-characters';
before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { downloadDir: '.data/mongodb-binaries' } });
  await mongoose.connect(mongo.getUri());
  app = createApp({ secret: 'testing-secret-that-is-longer-than-32-characters', sendMail: async message => emailMessages.push(message), appUrl: 'https://tempo.test' });
  owner = request.agent(app); editor = request.agent(app); other = request.agent(app);
  const own = await owner.post('/api/auth/register').set(...header).send({ name: 'Owner', email: 'owner@example.com', password: 'strong-owner-password' }).expect(200);
  await editor.post('/api/auth/register').set(...header).send({ name: 'Editor', email: 'editor@example.com', password: 'Editor-Changed-Password-2' }).expect(200);
  await other.post('/api/auth/register').set(...header).send({ name: 'Viewer', email: 'viewer@example.com', password: 'Viewer-Changed-Password-2' }).expect(200);
  for (const [agent, email, role] of [[editor, 'editor@example.com', 'editor'], [other, 'viewer@example.com', 'viewer']]) {
    await owner.post('/api/workspace-invitations').set(...header).send({ name: role, email, role }).expect(201);
    const token = emailMessages.at(-1).text.match(/invitation=([A-Za-z0-9_-]+)/)[1];
    await agent.post('/api/invitations/accept').set(...header).send({ token }).expect(200);
    agent.set('X-Workspace-Id', own.body.workspaceId);
  }
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test('legacy user documents receive safe role defaults without serializing secrets', () => {
  const legacy = User.hydrate({ _id: new mongoose.Types.ObjectId(), name: 'Legacy user', email: 'legacy@example.com', passwordHash: 'stored-hash' });
  assert.equal(legacy.role, 'editor');
  assert.equal(legacy.status, 'active');
  assert.equal(legacy.isPrimaryAdmin, false);
  assert.equal(legacy.sessionVersion, 0);
  const json = legacy.toJSON();
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.resetCodeHash, undefined);
  assert.equal(json.sessionVersion, undefined);
});

test('authentication, validation, authorization and complete CRUD with real MongoDB', async () => {
  await request(app).get('/api/data').expect(401);
  await request(app).post('/api/auth/register').set(...header).send({ name: 'Duplicate', email: 'owner@example.com', password: 'strong-public-password' }).expect(409);
  await owner.get('/api/auth/me').expect(200).expect(({ body }) => { assert.equal(body.role, 'owner'); assert.equal(body.passwordHash, undefined); });
  await owner.post('/api/websites').set(...header).send({ ...website, url: 'javascript:alert(1)' }).expect(400);
  websiteId = (await editor.post('/api/websites').set(...header).send(website).expect(201)).body.id;
  const entry = { websiteId, date: '2026-11-05', description: '=Formula injection test', category: 'Development', hours: 2, minutes: 30, notes: 'A real work entry' };
  await editor.post('/api/logs').set(...header).send({ ...entry, minutes: 60 }).expect(400);
  await editor.post('/api/logs').set(...header).send({ ...entry, date: '2025-12-31' }).expect(400);
  await other.post('/api/logs').set(...header).send(entry).expect(403);
  const created = await editor.post('/api/logs').set(...header).send(entry).expect(201); logId = created.body.id; assert.equal(created.body.totalMinutes, 150);
  await other.put(`/api/logs/${logId}`).set(...header).send(entry).expect(403);
  const edited = await editor.put(`/api/logs/${logId}`).set(...header).send({ ...entry, hours: 3, minutes: 15 }).expect(200); assert.equal(edited.body.totalMinutes, 195);
  allocationId = (await editor.put('/api/allocations').set(...header).send({ websiteId, year: 2026, month: 11, allocatedHours: 4 }).expect(200)).body.id;
  await editor.put('/api/allocations').set(...header).send({ websiteId, year: 2026, month: 11, allocatedHours: 5 }).expect(200);
  const data = (await owner.get('/api/data').expect(200)).body;
  assert.equal(data.logs.length, 1); assert.equal(data.allocations.length, 1); assert.equal(data.allocations[0].allocatedHours, 5);
  assert.equal((await other.get('/api/data')).body.logs.length, 1);
  const csv = await owner.get(`/api/export/csv?websiteId=${websiteId}&from=2026-11-01&to=2026-11-30`).expect(200); assert.match(csv.text, /Test website/); assert.match(csv.text, /195/); assert.match(csv.text, /'=Formula/);
  const xlsx = await owner.get(`/api/export/xlsx?websiteId=${websiteId}`).buffer(true).parse((res, cb) => { const bytes = []; res.on('data', chunk => bytes.push(chunk)); res.on('end', () => cb(null, Buffer.concat(bytes))); }).expect(200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.body); assert.equal(workbook.worksheets[0].rowCount, 2); assert.equal(workbook.worksheets[0].getRow(2).getCell(7).value, 195);
  const backup = (await owner.get('/api/backup').expect(200)).body; assert.equal(backup.logs.length, 1); assert.equal(backup.websites.length, 1); assert.equal(backup.version, 1);
  await other.delete(`/api/logs/${logId}`).set(...header).expect(403);
  await owner.delete(`/api/logs/${logId}`).set(...header).expect(200); assert.equal((await owner.get('/api/data')).body.logs.length, 0);
  await editor.post('/api/logs').set(...header).send(entry).expect(201);
  await editor.delete(`/api/allocations/${allocationId}`).set(...header).expect(200);
  await editor.put('/api/allocations').set(...header).send({ websiteId, year: 2026, month: 11, allocatedHours: 2 }).expect(200);
  await editor.put(`/api/websites/${websiteId}`).set(...header).send({ ...website, status: 'Inactive' }).expect(200);
  await owner.delete(`/api/websites/${websiteId}`).set(...header).expect(200);
  const empty = (await owner.get('/api/data')).body; assert.equal(empty.websites.length, 0); assert.equal(empty.logs.length, 0); assert.equal(empty.allocations.length, 0);
  await editor.post('/api/auth/logout').set(...header).expect(200); await editor.get('/api/data').expect(401);
  await editor.post('/api/auth/login').set(...header).send({ email: 'editor@example.com', password: 'wrong-password' }).expect(401);
  await editor.post('/api/auth/login').set(...header).send({ email: 'editor@example.com', password: 'Editor-Changed-Password-2' }).expect(200);
});

test('individual and combined exports include complete historical work history', async () => {
  const account = owner;
  const siteA = (await account.post('/api/websites').set(...header).send({ ...website, name: 'Website A', url: 'https://a.example.com', startDate: '2020-01-01' }).expect(201)).body;
  const siteB = (await account.post('/api/websites').set(...header).send({ ...website, name: 'Website B', url: 'https://b.example.com', startDate: '2020-01-01' }).expect(201)).body;
  const emptySite = (await account.post('/api/websites').set(...header).send({ ...website, name: 'Empty', url: 'https://empty.example.com' }).expect(201)).body;
  const first = (await account.post('/api/logs').set(...header).send({ websiteId: siteA.id, date: '2020-04-03', description: 'Quoted, "work"', category: 'Design', hours: 1, minutes: 5, notes: 'Line one,\nline two' }).expect(201)).body;
  await account.post('/api/logs').set(...header).send({ websiteId: siteA.id, date: '2026-03-20', description: 'Recent work', category: 'Development', hours: 2, minutes: 0, notes: 'Current project' }).expect(201);
  await account.post('/api/logs').set(...header).send({ websiteId: siteB.id, date: '2021-08-09', description: 'Separate project', category: 'Maintenance', hours: 1, minutes: 30, notes: '' }).expect(201);

  await request(app).get(`/api/websites/${siteA.id}/export/csv`).expect(401);
  await account.get('/api/websites/not-a-mongo-id/export/csv').expect(400);
  await other.get(`/api/websites/${siteA.id}/export/csv`).expect(200);

  const siteCsv = await account.get(`/api/websites/${siteA.id}/export/csv`).expect(200);
  assert.match(siteCsv.headers['content-disposition'], /Website-A-Work-Report\.csv/);
  assert.match(siteCsv.headers['content-type'], /text\/csv; charset=utf-8/);
  assert.match(siteCsv.text, /Website Name/);
  assert.match(siteCsv.text, /https:\/\/a\.example\.com/);
  assert.match(siteCsv.text, /"Quoted, ""work"""/);
  assert.match(siteCsv.text, /Line one,\nline two/);
  assert.doesNotMatch(siteCsv.text, /Website B|b\.example\.com|Separate project/);
  assert.ok(siteCsv.text.indexOf('2020-04-03') < siteCsv.text.indexOf('2026-03-20'));

  const siteXlsx = await account.get(`/api/websites/${siteA.id}/export/xlsx`).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  assert.match(siteXlsx.headers['content-disposition'], /Website-A-Work-Report\.xlsx/);
  const individualWorkbook = new ExcelJS.Workbook();
  await individualWorkbook.xlsx.load(siteXlsx.body);
  const history = individualWorkbook.getWorksheet('Work History');
  assert.equal(history.rowCount, 3);
  assert.deepEqual(history.getRow(1).values.slice(1), ['Date', 'Website Name', 'Website URL', 'Work Description', 'Work Category', 'Hours', 'Minutes', 'Total Time', 'Notes', 'Created At']);
  assert.equal(history.getRow(2).getCell(1).value, '2020-04-03');
  assert.equal(history.getRow(2).getCell(2).value, 'Website A');
  assert.equal(history.getRow(2).getCell(3).value, 'https://a.example.com');
  assert.equal(history.getRow(2).getCell(4).value, 'Quoted, "work"');
  assert.equal(history.getRow(2).getCell(8).value, '1h 5m');
  assert.equal(history.getRow(2).getCell(9).value, 'Line one,\nline two');
  assert.equal(history.getRow(2).getCell(10).value, first.createdAt);

  const allCsv = await account.get('/api/export/all/csv').expect(200);
  assert.match(allCsv.text, /Website A/);
  assert.match(allCsv.text, /Website B/);
  assert.match(allCsv.text, /https:\/\/b\.example\.com/);
  assert.ok(allCsv.text.indexOf('2020-04-03') < allCsv.text.indexOf('2021-08-09'));
  assert.ok(allCsv.text.indexOf('2021-08-09') < allCsv.text.indexOf('2026-03-20'));

  const allXlsx = await account.get('/api/export/all/xlsx').buffer(true).parse((res, cb) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  assert.match(allXlsx.headers['content-disposition'], /All-Projects-Work-Report\.xlsx/);
  const combinedWorkbook = new ExcelJS.Workbook();
  await combinedWorkbook.xlsx.load(allXlsx.body);
  assert.deepEqual(combinedWorkbook.worksheets.map(sheet => sheet.name), ['Summary', 'Empty', 'Website A', 'Website B', 'All Work Logs']);
  assert.equal(combinedWorkbook.getWorksheet('Website A').rowCount, 3);
  assert.equal(combinedWorkbook.getWorksheet('Website B').rowCount, 2);
  assert.equal(combinedWorkbook.getWorksheet('Empty').rowCount, 1);
  assert.equal(combinedWorkbook.getWorksheet('All Work Logs').rowCount, 4);
  assert.equal(combinedWorkbook.getWorksheet('Summary').getRow(2).getCell(3).value, 0);

  const emptyCsv = await account.get(`/api/websites/${emptySite.id}/export/csv`).expect(200);
  assert.equal(emptyCsv.text.split('\r\n').length, 1);
  const emptyXlsx = await account.get(`/api/websites/${emptySite.id}/export/xlsx`).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(emptyXlsx.body);
  assert.equal(emptyWorkbook.worksheets[0].rowCount, 1);
});


test('combined Excel export accepts reserved, quoted, duplicate and long website names', async () => {
  const names = ['History', "'Quoted'", 'Summary', 'All Work Logs', 'x'.repeat(30) + "'tail", 'Same/Name', 'Same:Name'];
  for (const name of names) await owner.post('/api/websites').set(...header).send({ ...website, name }).expect(201);
  const result = await other.get('/api/export/all/xlsx').buffer(true).parse((res, cb) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.body);
  const sheets = workbook.worksheets.map(sheet => sheet.name);
  assert.equal(new Set(sheets.map(name => name.toLowerCase())).size, sheets.length);
  assert.ok(sheets.includes('Website History'));
  assert.ok(sheets.includes('Quoted'));
  assert.ok(sheets.every(name => name.length <= 31 && !name.startsWith("'") && !name.endsWith("'")));
});
