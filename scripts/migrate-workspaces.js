import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { User, Workspace, Membership, WorkspaceInvitation, Website, WorkLog, MonthlyAllocation, AuditLog } from '../server/models.js';
import { ensurePersonalWorkspace } from '../server/workspaces.js';

const apply = process.argv.includes('--apply');
try {
  if (!process.env.MONGODB_URI) throw new Error('missing-configuration');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  const models = [User, Workspace, Membership, WorkspaceInvitation, Website, WorkLog, MonthlyAllocation, AuditLog];
  const counts = {};
  for (const model of models) counts[model.modelName] = await model.countDocuments({});
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', counts, pendingAccounts: await User.countDocuments({ workspaceMigrationVersion: { $ne: 1 } }) }));
  if (apply) {
    const snapshot = { version: 1, exportedAt: new Date(), collections: {} };
    for (const model of models) snapshot.collections[model.collection.name] = await model.collection.find({}).toArray();
    const directory = path.resolve('.data/backups'); mkdirSync(directory, { recursive: true });
    const backup = path.join(directory, `before-workspaces-${Date.now()}-${randomBytes(4).toString('hex')}.ejson`);
    writeFileSync(backup, mongoose.mongo.BSON.EJSON.stringify(snapshot, { relaxed: false }), { mode: 0o600, flag: 'wx' });
    console.log(`Backup written to ${backup}. Contains private account hashes; keep it private.`);
    // Build only new indexes; never drop or sync existing indexes.
    await Promise.all([Workspace.createIndexes(), Membership.createIndexes(), WorkspaceInvitation.createIndexes()]);
    for await (const user of User.find({}).sort({ createdAt: 1 }).cursor()) await ensurePersonalWorkspace(user);
    console.log('Additive workspace upgrade complete. No accounts or records were deleted.');
  } else console.log('Read-only preview complete. No database changes made. Use --apply only after reviewing the target database and backup procedure.');
} catch {
  console.error('Workspace migration did not complete. Check database access, legacy ownership references and unique indexes. No connection credentials were displayed.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
