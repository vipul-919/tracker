import 'dotenv/config';
import mongoose from 'mongoose';
import { User, Website, WorkLog, MonthlyAllocation, AuditLog } from '../server/models.js';

// Operator-only recovery for an existing owner. Dry run unless --apply is supplied.
// Does not reset credentials, delete records, or attach unrelated accounts.
const emailIndex = process.argv.indexOf('--email');
const email = process.argv[emailIndex + 1]?.trim().toLowerCase();
const apply = process.argv.includes('--apply');
if (emailIndex < 0 || !email?.includes('@')) throw new Error('Usage: node scripts/upgrade-owner.js --email owner@example.com [--apply]');
try {
  if (!process.env.MONGODB_URI) throw new Error('configuration');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  const owner = await User.findOne({ email });
  if (!owner) throw new Error('account');
  const existing = await User.findOne({ isPrimaryAdmin: true });
  if (existing && String(existing._id) !== String(owner._id)) throw new Error('different-owner');
  if (owner.workspaceId && String(owner.workspaceId) !== String(owner._id)) throw new Error('different-workspace');
  const unstamped = { workspaceId: { $exists: false }, userId: owner._id };
  const counts = {};
  for (const model of [Website, WorkLog, MonthlyAllocation, AuditLog]) counts[model.modelName] = await model.countDocuments(unstamped);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', email, accountExists: true, alreadyOwner: Boolean(owner.isPrimaryAdmin), ownedLegacyRecords: counts }));
  if (apply) {
    // The existing partial unique owner index rejects a competing owner claim.
    await User.updateOne({ _id: owner._id }, { $set: { isPrimaryAdmin: true, role: 'admin', workspaceId: owner._id }, ...(!owner.isPrimaryAdmin ? { $inc: { sessionVersion: 1 } } : {}) });
    for (const model of [Website, WorkLog, MonthlyAllocation, AuditLog]) await model.updateMany(unstamped, { $set: { workspaceId: owner._id } });
    console.log('Owner upgrade complete. Sign in again. Existing password and records preserved.');
  } else console.log('No changes made. Review the account and record counts before using --apply.');
} catch (error) {
  const reasons = { configuration: 'Configure MONGODB_URI privately first.', account: 'The requested account was not found.', 'different-owner': 'A different owner already exists. No ownership transfer was performed.', 'different-workspace': 'This account belongs to a different workspace.' };
  console.error(reasons[error.message] || 'Owner upgrade failed. Check database access and the existing unique owner index. No credentials were displayed.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
