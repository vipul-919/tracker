import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../server/app.js';
import { ensurePersonalWorkspace } from '../server/workspaces.js';
import { User, Workspace, Membership, WorkspaceInvitation, WorkspacePresence, Website, WorkLog, MonthlyAllocation, AuditLog } from '../server/models.js';

let mongo, app, people, messages = [], failMail = false;
const secret = 'collaboration-integration-secret-at-least-32-characters';
const password = 'Independent-Personal-Password-1';
const headers = ['X-Requested-With', 'Tempo'];
const siteInput = name => ({ name, url: 'https://example.test', description: '', defaultMonthlyHours: 12, startDate: '2020-01-01', status: 'Active' });
const logInput = websiteId => ({ websiteId, date: '2026-11-05', description: '=Shared task', category: 'Development', hours: 2, minutes: 15, notes: 'Shared notes' });
const lastToken = () => messages.at(-1).text.match(/invitation=([A-Za-z0-9_-]+)/)[1];
const post = (person, path, body, workspaceId = person.workspaceId) => person.agent.post(path).set(...headers).set('X-Workspace-Id', workspaceId).send(body);
const invite = async (from, to, role) => {
  const result = await post(from, '/api/workspace-invitations', { name: to.name, email: to.email, role }).expect(201);
  assert.equal(result.body.tokenHash, undefined); assert.equal(result.body.token, undefined);
  return { invitation: result.body, token: lastToken() };
};
before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { downloadDir: '.data/mongodb-binaries' } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Workspace.init(), Membership.init(), WorkspaceInvitation.init()]);
  app = createApp({ secret, appUrl: 'https://tempo.test', sendMail: async message => { if (failMail) throw new Error('Simulated SMTP failure'); messages.push(message); } });
  people = [];
  for (let i = 1; i <= 3; i++) {
    const agent = request.agent(app), name = 'Person ' + i, email = `person${i}@example.test`;
    const result = await agent.post('/api/auth/register').set(...headers).send({ name, email, password }).expect(200);
    people.push({ agent, ...result.body, name, email });
  }
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('three people register with separate identities, owner memberships and private workspaces', async () => {
  assert.equal(new Set(people.map(p => p.workspaceId)).size, 3);
  for (const p of people) {
    assert.equal(p.role, 'owner'); assert.equal(p.passwordHash, undefined);
    const workspaces = (await p.agent.get('/api/workspaces').expect(200)).body;
    assert.equal(workspaces.length, 1); assert.equal(workspaces[0].role, 'owner');
    p.site = (await post(p, '/api/websites', siteInput(p.name + ' private website')).expect(201)).body;
    const result = await p.agent.get('/api/data').set('X-Workspace-Id', p.workspaceId).expect(200);
    assert.deepEqual(result.body.websites.map(w => w.id), [p.site.id]);
    assert.equal(result.body.role, 'owner');
  }
  await request(app).post('/api/auth/register').set(...headers).send({ name: 'Duplicate', email: people[0].email.toUpperCase(), password }).expect(409);
  await request(app).get('/api/data').expect(401);
});

test('existing users accept Editor and Viewer invitations; no account or personal workspace is replaced', async () => {
  const [p1, p2, p3] = people;
  for (const [recipient, role] of [[p2, 'editor'], [p3, 'viewer']]) {
    const { invitation, token } = await invite(p1, recipient, role);
    recipient.acceptedToken = token;
    assert.equal(await Membership.countDocuments({ workspaceId: p1.workspaceId, userId: recipient.id }), 0);
    assert.equal((await recipient.agent.get('/api/workspaces').expect(200)).body.length, 1);
    assert.equal(messages.at(-1).subject.includes(p1.workspaceName), true);
    const stored = await WorkspaceInvitation.findById(invitation.id).select('+tokenHash');
    assert.equal(stored.tokenHash, createHash('sha256').update(token).digest('hex')); assert.notEqual(stored.tokenHash, token);
    await post(recipient, '/api/invitations/inspect', { token }).expect(200);
    const accepted = await Promise.all([post(recipient, '/api/invitations/accept', { token }), post(recipient, '/api/invitations/accept', { token })]);
    assert.deepEqual(accepted.map(r => r.status).sort(), [200, 409]);
    const workspaces = (await recipient.agent.get('/api/workspaces').expect(200)).body;
    assert.equal(workspaces.find(w => w.id === recipient.workspaceId).role, 'owner');
    assert.equal(workspaces.find(w => w.id === p1.workspaceId).role, role);
    await post(recipient, '/api/invitations/accept', { token }).expect(409);
  }
  assert.equal(await User.countDocuments({}), 3); assert.equal(await Workspace.countDocuments({}), 3);
});

test('Editor CRUD and Viewer downloads are allowed only in the selected workspace', async () => {
  const [p1, p2, p3] = people;
  const shared = p1.workspaceId;
  const editorSite = (await post(p2, '/api/websites', { ...siteInput('Team project'), workspaceId: p2.workspaceId }, shared).expect(201)).body;
  assert.equal(editorSite.workspaceId, shared);
  const log = (await post(p2, '/api/logs', logInput(editorSite.id), shared).expect(201)).body;
  const allocation = (await p2.agent.put('/api/allocations').set(...headers).set('X-Workspace-Id', shared).send({ websiteId: editorSite.id, month: 11, year: 2026, allocatedHours: 0 }).expect(200)).body;
  await p2.agent.put('/api/logs/' + log.id).set(...headers).set('X-Workspace-Id', shared).send({ ...logInput(editorSite.id), minutes: 30 }).expect(200);
  await p2.agent.put('/api/websites/' + editorSite.id).set(...headers).set('X-Workspace-Id', shared).send({ ...siteInput('Team project'), status: 'Inactive' }).expect(200);
  const data = (await p3.agent.get('/api/data').set('X-Workspace-Id', shared).expect(200)).body;
  assert.equal(data.logs[0].totalMinutes, 150); assert.equal(data.allocations[0].allocatedHours, 0); assert.equal(data.role, 'viewer');
  for (const path of ['/api/websites', '/api/logs']) await post(p3, path, path.endsWith('logs') ? logInput(editorSite.id) : siteInput('Denied'), shared).expect(403);
  for (const [path, value] of [[`/api/websites/${editorSite.id}`,siteInput('Denied')], [`/api/logs/${log.id}`,logInput(editorSite.id)], ['/api/allocations',{ websiteId: editorSite.id, month: 11, year: 2026, allocatedHours: 5 }]]) {
    await p3.agent.put(path).set(...headers).set('X-Workspace-Id', shared).send(value).expect(403);
  }
  for (const path of [`/api/websites/${editorSite.id}`,`/api/logs/${log.id}`,`/api/allocations/${allocation.id}`]) await p3.agent.delete(path).set(...headers).set('X-Workspace-Id', shared).expect(403);
  for (const path of ['/api/members','/api/audit-logs','/api/backup']) { await p2.agent.get(path).set('X-Workspace-Id', shared).expect(403); await p3.agent.get(path).set('X-Workspace-Id', shared).expect(403); }
  const csv = await p3.agent.get('/api/export/all/csv').set('X-Workspace-Id', shared).expect(200);
  assert.match(csv.text, /Team project/); assert.match(csv.text, /'=Shared task/); assert.doesNotMatch(csv.text, /Person 2 private/);
  await p3.agent.get(`/api/websites/${editorSite.id}/export/csv`).set('X-Workspace-Id', shared).expect(200);
  const bytes = await p3.agent.get('/api/export/all/xlsx').set('X-Workspace-Id', shared).buffer(true).parse((res, cb) => { const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks))); }).expect(200);
  const { default: ExcelJS } = await import('exceljs'); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes.body);
  assert.ok(workbook.worksheets.some(w => w.name === 'Team project')); assert.ok(workbook.worksheets.every(w => !w.name.includes('Person 2')));
  await p2.agent.delete('/api/logs/' + log.id).set(...headers).set('X-Workspace-Id', shared).expect(200);
  await p2.agent.delete('/api/allocations/' + allocation.id).set(...headers).set('X-Workspace-Id', shared).expect(200);
});

test('reciprocal invitations allow the same identity to own one workspace and edit/view others', async () => {
  const [p1,p2,p3]=people;
  for (const [from,role] of [[p2,'editor'],[p3,'viewer']]) { const {token}=await invite(from,p1,role);await post(p1,'/api/invitations/accept',{token}).expect(200); }
  const workspaces=(await p1.agent.get('/api/workspaces').expect(200)).body;
  assert.deepEqual(workspaces.map(w=>w.role).sort(),['editor','owner','viewer']);
  await post(p1,`/api/workspaces/${p2.workspaceId}/select`,{}).expect(200).expect(({body})=>assert.equal(body.role,'editor'));
  await p1.agent.get('/api/auth/me').expect(200).expect(({body})=>assert.equal(body.workspaceId,p2.workspaceId));
  await post(p1,'/api/websites',siteInput('P1 works in P2'),p2.workspaceId).expect(201);
  await post(p1,'/api/workspace-invitations',{name:'Denied',email:'denied@example.test',role:'viewer'},p2.workspaceId).expect(403);
  await post(p1,'/api/websites',siteInput('Denied'),p3.workspaceId).expect(403);
  await post(p1,`/api/workspaces/${p1.workspaceId}/select`,{}).expect(200);
  await p1.agent.get('/api/data').set('X-Workspace-Id',p1.workspaceId).expect(200).expect(({body})=>assert.ok(body.websites.every(w=>w.name!=='P1 works in P2')));
});

test('workspace IDs and record IDs cannot bypass membership, including global legacy Admin roles', async () => {
  const [p1,p2,p3]=people;
  await p2.agent.get('/api/data').set('X-Workspace-Id',p3.workspaceId).expect(403);
  await p2.agent.get(`/api/websites/${p3.site.id}/export/csv`).set('X-Workspace-Id',p2.workspaceId).expect(404);
  await p2.agent.delete('/api/websites/'+p3.site.id).set(...headers).set('X-Workspace-Id',p2.workspaceId).expect(404);
  await post(p2,'/api/logs',logInput(p3.site.id),p2.workspaceId).expect(404);
  await User.updateOne({_id:p3.id},{$set:{role:'admin'}});
  await post(p3,'/api/websites',siteInput('Global role cannot override Viewer'),p1.workspaceId).expect(403);
  await post(p2,`/api/workspaces/${p3.workspaceId}/select`,{}).expect(403);
});

test('role changes and removals affect one membership immediately, never the account or personal workspace', async () => {
  const [p1,p2]=people;
  const rows=(await p1.agent.get('/api/members').set('X-Workspace-Id',p1.workspaceId).expect(200)).body;
  const owner=rows.members.find(m=>m.role==='owner'),member=rows.members.find(m=>m.userId===p2.id);
  await p1.agent.delete('/api/members/'+owner.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).expect(403);
  await p1.agent.put('/api/members/'+owner.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).send({role:'viewer'}).expect(403);
  await p1.agent.put('/api/members/'+member.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).send({role:'viewer'}).expect(200);
  await post(p2,'/api/websites',siteInput('Role downgraded'),p1.workspaceId).expect(403);
  await p1.agent.put('/api/members/'+member.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).send({status:'inactive'}).expect(200);
  await p2.agent.get('/api/data').set('X-Workspace-Id',p1.workspaceId).expect(403);
  await p2.agent.get('/api/data').set('X-Workspace-Id',p2.workspaceId).expect(200);
  await p1.agent.delete('/api/members/'+member.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).expect(200);
  assert.ok(await User.exists({_id:p2.id})); assert.ok(await Workspace.exists({_id:p2.workspaceId}));
  assert.equal((await p2.agent.get('/api/workspaces').expect(200)).body.length,1);
  await post(p2, '/api/invitations/accept', { token: p2.acceptedToken }).expect(409);
  assert.equal(await Membership.countDocuments({ workspaceId: p1.workspaceId, userId: p2.id }), 0);
});

test('new invitees register a personal workspace then accept; wrong recipient, rejection, expiry, resend and cancellation are enforced', async () => {
  const [p1,p2]=people;
  const newEmail='new-invitee@example.test', name='New invitee';
  const invited=await invite(p1,{name,email:newEmail},'editor');
  assert.equal(await User.countDocuments({email:newEmail}),0);
  await post(p2,'/api/invitations/accept',{token:invited.token}).expect(400);
  const agent=request.agent(app); const registered=await agent.post('/api/auth/register').set(...headers).send({name,email:newEmail,password}).expect(200); const newcomer={agent,...registered.body};
  assert.equal((await agent.get('/api/workspaces')).body.length,1);
  await post(newcomer,'/api/invitations/accept',{token:invited.token}).expect(200);
  assert.equal((await agent.get('/api/workspaces')).body.length,2);
  const declined=await invite(p1,{name:'Reject user',email:'reject@example.test'},'viewer');
  const rejectAgent=request.agent(app); const rejectUser=(await rejectAgent.post('/api/auth/register').set(...headers).send({name:'Reject user',email:'reject@example.test',password}).expect(200)).body;
  await post({agent:rejectAgent,...rejectUser},'/api/invitations/reject',{token:declined.token}).expect(200);
  await post({agent:rejectAgent,...rejectUser},'/api/invitations/accept',{token:declined.token}).expect(400);
  const later=await invite(p1,{name:'Later user',email:'later@example.test'},'viewer');
  await post(p1,`/api/workspace-invitations/${later.invitation.id}/resend`,{}).expect(200); const replacement=lastToken(); assert.notEqual(later.token,replacement);
  const laterAgent=request.agent(app), laterUser=(await laterAgent.post('/api/auth/register').set(...headers).send({name:'Later user',email:'later@example.test',password}).expect(200)).body, person={agent:laterAgent,...laterUser};
  await post(person,'/api/invitations/accept',{token:later.token}).expect(400);
  await WorkspaceInvitation.updateOne({_id:later.invitation.id},{$set:{expiresAt:new Date(Date.now()-1000)}});
  await post(person,'/api/invitations/accept',{token:replacement}).expect(400);
  await post(p1,`/api/workspace-invitations/${later.invitation.id}/resend`,{}).expect(200); const fresh=lastToken();
  await p1.agent.delete('/api/workspace-invitations/'+later.invitation.id).set(...headers).set('X-Workspace-Id',p1.workspaceId).expect(200);
  await post(person,'/api/invitations/accept',{token:fresh}).expect(400);
});

test('SMTP failure is reported honestly and resend repairs delivery without creating accounts or granting access', async () => {
  const p=people[0];failMail=true;
  const response=await post(p,'/api/workspace-invitations',{name:'Undelivered',email:'undelivered@example.test',role:'viewer'}).expect(201);
  assert.equal(response.body.deliveryStatus,'failed'); assert.equal(await User.countDocuments({email:'undelivered@example.test'}),0);
  failMail=false;
  await post(p,`/api/workspace-invitations/${response.body.id}/resend`,{}).expect(200).expect(({body})=>assert.equal(body.deliveryStatus,'sent'));
});

test('password recovery remains single-use, expiring and session-invalidating; workspace owners cannot reset others identities', async () => {
  const p=people[2];
  await request(app).post('/api/auth/forgot-password').set(...headers).send({email:p.email}).expect(200);
  const code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
  const results=await Promise.all(['Recovered-Password-A','Recovered-Password-B'].map(newPassword=>request(app).post('/api/auth/reset-password').set(...headers).send({email:p.email,code,password:newPassword})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  await p.agent.get('/api/data').expect(401);
  const chosen=results[0].status===200?'Recovered-Password-A':'Recovered-Password-B';
  const signed=await p.agent.post('/api/auth/login').set(...headers).send({email:p.email,password:chosen}).expect(200);
  const cookie=signed.headers['set-cookie'][0].split(';')[0];
  await p.agent.post('/api/auth/logout').set(...headers).expect(200);
  await request(app).get('/api/data').set('Cookie',cookie).expect(401);
  await people[0].agent.post('/api/users/'+p.id+'/reset-password').set(...headers).expect(410);
});

test('legacy upgrade is additive and idempotent, preserves existing shared membership and isolates new personal space', async () => {
  const legacyOwner=await User.create({name:'Legacy owner',email:'legacy-owner@example.test',passwordHash:await bcrypt.hash(password,4)});
  const legacyEditor=await User.create({name:'Legacy editor',email:'legacy-editor@example.test',passwordHash:await bcrypt.hash(password,4),workspaceId:legacyOwner._id,role:'editor'});
  const oldSite=await Website.create({...siteInput('Existing legacy project'),userId:legacyOwner._id});
  const oldLog=await WorkLog.create({...logInput(String(oldSite._id)),totalMinutes:135,userId:legacyOwner._id});
  const teammateLog=await WorkLog.create({...logInput(String(oldSite._id)),totalMinutes:135,userId:legacyEditor._id});
  const oldAllocation=await MonthlyAllocation.create({websiteId:oldSite._id,userId:legacyOwner._id,year:2026,month:11,allocatedHours:8});
  const editorSite=await Website.create({...siteInput('Legacy team project'),userId:legacyEditor._id});
  await ensurePersonalWorkspace(legacyOwner); await ensurePersonalWorkspace(legacyEditor);
  const counts=[await Workspace.countDocuments({}),await Membership.countDocuments({}),await Website.countDocuments({}),await WorkLog.countDocuments({})];
  await ensurePersonalWorkspace(await User.findById(legacyOwner._id)); await ensurePersonalWorkspace(await User.findById(legacyEditor._id));
  assert.deepEqual([await Workspace.countDocuments({}),await Membership.countDocuments({}),await Website.countDocuments({}),await WorkLog.countDocuments({})],counts);
  for(const model of [Website,WorkLog,MonthlyAllocation])assert.ok(await model.exists({workspaceId:legacyOwner._id}));
  assert.ok(await WorkLog.exists({_id:oldLog._id})); assert.ok(await MonthlyAllocation.exists({_id:oldAllocation._id}));
  assert.equal(String((await WorkLog.findById(teammateLog._id)).workspaceId), String(legacyOwner._id));
  assert.equal(String((await Website.findById(editorSite._id)).workspaceId),String(legacyOwner._id));
  assert.equal((await Membership.findOne({workspaceId:legacyEditor._id,userId:legacyEditor._id})).role,'owner');
  assert.equal((await Membership.findOne({workspaceId:legacyOwner._id,userId:legacyEditor._id})).role,'editor');
  assert.equal(await AuditLog.countDocuments({workspaceId:people[0].workspaceId})>0,true);
});

test('bulk migration preview is read-only and apply backs up before idempotent upgrades', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  const run = promisify(execFile);
  const legacy = await User.create({ name: 'Bulk upgrade', email: 'bulk@example.test', passwordHash: await bcrypt.hash(password, 4) });
  const site = await Website.create({ ...siteInput('Bulk history'), userId: legacy._id });
  const options = { env: { ...process.env, MONGODB_URI: mongo.getUri() }, timeout: 30000 };
  const before = await Workspace.countDocuments({});
  const preview = await run(process.execPath, ['scripts/migrate-workspaces.js'], options);
  assert.match(preview.stdout, /No database changes made/);
  assert.equal(await Workspace.countDocuments({}), before);
  assert.equal((await User.findById(legacy._id)).workspaceMigrationVersion, 0);
  const applied = await run(process.execPath, ['scripts/migrate-workspaces.js', '--apply'], options);
  const backupPath = applied.stdout.match(/Backup written to (.+\.ejson)\./)[1];
  const backup = mongoose.mongo.BSON.EJSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.version, 1);
  assert.ok(backup.collections.users.some(u => String(u._id) === String(legacy._id)));
  assert.ok(backup.collections.websites.some(w => String(w._id) === String(site._id)));
  const after = await Workspace.countDocuments({});
  await run(process.execPath, ['scripts/migrate-workspaces.js', '--apply'], options);
  assert.equal(await Workspace.countDocuments({}), after);
  assert.equal(String((await Website.findById(site._id)).workspaceId), String(legacy._id));
});

test('pre-role legacy identities retain recovery expiry and logout invalidation without stored default fields', async () => {
  const email = 'pre-role@example.test';
  await User.collection.insertOne({ name: 'Pre-role account', email, passwordHash: await bcrypt.hash(password, 4), createdAt: new Date(), updatedAt: new Date() });
  await request(app).post('/api/auth/forgot-password').set(...headers).send({ email }).expect(200);
  const expiredCode = messages.at(-1).text.match(/\b\d{8}\b/)[0];
  await User.updateOne({ email }, { $set: { resetCodeExpiry: new Date(Date.now() - 1000) } });
  await request(app).post('/api/auth/reset-password').set(...headers).send({ email, code: expiredCode, password: 'Expired-Password-Should-Fail' }).expect(400);
  await request(app).post('/api/auth/forgot-password').set(...headers).send({ email }).expect(200);
  const code = messages.at(-1).text.match(/\b\d{8}\b/)[0];
  await request(app).post('/api/auth/reset-password').set(...headers).send({ email, code, password: 'Legacy-Recovered-Password-2' }).expect(200);
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').set(...headers).send({ email, password: 'Legacy-Recovered-Password-2' }).expect(200);
  assert.equal(login.body.role, 'owner');
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  await agent.post('/api/auth/logout').set(...headers).expect(200);
  await request(app).get('/api/data').set('Cookie', cookie).expect(401);
});


test('shared directory, tab presence, session invalidation and Admin permissions stay workspace scoped', async () => {
  const register = async name => {
    const agent = request.agent(app), email = `${name.toLowerCase()}@directory.example.test`;
    const response = await agent.post('/api/auth/register').set(...headers).send({ name, email, password }).expect(200);
    return { ...response.body, agent, email, name };
  };
  const owner = await register('DirectoryOwner'), member = await register('DirectoryMember');
  const shared = owner.workspaceId;
  const { token } = await invite(owner, member, 'admin');
  let roster = (await owner.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared).expect(200)).body;
  assert.equal(roster.invitations[0].name, member.name);
  assert.equal(roster.invitations[0].status, 'pending');
  assert.equal(roster.invitations[0].tokenHash, undefined);
  await member.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared).expect(403);
  await post(member, '/api/invitations/accept', { token }).expect(200);
  const firstTab = randomUUID(), secondTab = randomUUID();
  await post(member, '/api/workspace-presence', { clientId: firstTab, active: true, userId: owner.id }, shared).expect(200);
  await post(member, '/api/workspace-presence', { clientId: secondTab, active: true }, shared).expect(200);
  for (const person of [owner, member]) {
    roster = (await person.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared).expect(200)).body;
    assert.deepEqual(new Set(roster.members.map(m => m.email)), new Set([owner.email, member.email]));
    assert.equal(roster.invitations.length, 0);
    assert.equal(roster.members.find(m => m.id === member.id).online, true);
    assert.equal(roster.members.find(m => m.id === owner.id).online, false);
    assert.equal(roster.members[0].sessionVersion, undefined);
  }
  await post(member, '/api/workspace-presence', { clientId: firstTab, active: false }, shared).expect(200);
  roster = (await owner.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared)).body;
  assert.equal(roster.members.find(m => m.id === member.id).online, true, 'Another active tab keeps member online');
  await WorkspacePresence.updateMany({ userId: member.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  roster = (await owner.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared)).body;
  assert.equal(roster.members.find(m => m.id === member.id).online, false, 'Expiry is checked without waiting for TTL deletion');
  await post(member, '/api/workspace-presence', { clientId: secondTab, active: true }, shared).expect(200);
  await post(member, '/api/websites', siteInput('Admin project'), shared).expect(201);
  for (const path of ['/api/members', '/api/audit-logs', '/api/backup']) await member.agent.get(path).set('X-Workspace-Id', shared).expect(403);
  await member.agent.put('/api/workspaces/current').set(...headers).set('X-Workspace-Id', shared).send({ name: 'Denied' }).expect(403);
  await post(member, '/api/workspace-invitations', { name: 'Denied', email: 'denied@example.test', role: 'owner' }, shared).expect(403);
  await post(owner, `/api/workspaces/${member.workspaceId}/select`, {}).expect(403);
  await owner.agent.get('/api/workspace-roster').set('X-Workspace-Id', member.workspaceId).expect(403);
  const selected = (await post(member, `/api/workspaces/${shared}/select`, {}).expect(200)).body;
  assert.equal(selected.id, member.id); assert.equal(selected.email, member.email); assert.equal(selected.role, 'admin');
  await post(member, '/api/auth/logout', {}).expect(200);
  roster = (await owner.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared)).body;
  assert.equal(roster.members.find(m => m.id === member.id).online, false, 'Revoked sessions cannot remain online');
  await member.agent.post('/api/auth/login').set(...headers).send({ email: member.email, password }).expect(200);
  await post(member, '/api/workspace-presence', { clientId: secondTab, active: true }, shared).expect(200);
  const membership = await Membership.findOne({ workspaceId: shared, userId: member.id });
  await owner.agent.put(`/api/members/${membership.id}`).set(...headers).set('X-Workspace-Id', shared).send({ role: 'viewer' }).expect(200);
  await post(member, '/api/websites', siteInput('Denied after downgrade'), shared).expect(403);
  await owner.agent.put(`/api/members/${membership.id}`).set(...headers).set('X-Workspace-Id', shared).send({ status: 'inactive' }).expect(200);
  await post(member, '/api/workspace-presence', { clientId: secondTab, active: true }, shared).expect(403);
  await member.agent.get('/api/workspace-roster').set('X-Workspace-Id', shared).expect(403);
  assert.equal((await member.agent.get('/api/workspaces').expect(200)).body.some(w => w.id === shared), false);
  await member.agent.get('/api/workspace-roster').set('X-Workspace-Id', member.workspaceId).expect(200);
});
