import mongoose from 'mongoose';
const { Schema } = mongoose;
const workspace = { workspaceId: { type: Schema.Types.ObjectId, ref: 'User', index: true } };
const owned = { ...workspace, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true } };
const opts = { timestamps: true, toJSON: { transform(_doc, ret) { ret.id = String(ret._id); if (ret.websiteId) ret.websiteId = String(ret.websiteId); if (ret.userId) ret.userId = String(ret.userId); delete ret._id; delete ret.__v; delete ret.tokenHash; delete ret.passwordHash; delete ret.resetCodeHash; delete ret.resetCodeExpiry; delete ret.resetAttempts; delete ret.resetRequestCount; delete ret.resetRequestWindowStart; delete ret.sessionVersion; return ret; } } };
const roles = ['admin', 'editor', 'viewer'];
const userSchema = new Schema({
  ...workspace,
  workspaceMigrationVersion: { type: Number, default: 0 },
  lastWorkspaceId: { type: Schema.Types.ObjectId },
	name: { type: String, required: true, trim: true, maxlength: 100 },
	email: { type: String, unique: true, required: true, lowercase: true, trim: true, maxlength: 254 },
	username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, maxlength: 40 },
	passwordHash: { type: String, required: true, select: false },
	role: { type: String, enum: roles, default: 'editor' },
	status: { type: String, enum: ['active', 'inactive'], default: 'active' },
	isPrimaryAdmin: { type: Boolean, default: false },
	mustChangePassword: { type: Boolean, default: false },
	lastLogin: Date,
	resetCodeHash: { type: String, select: false },
	resetCodeExpiry: { type: Date, select: false },
	resetAttempts: { type: Number, default: 0, select: false },
	resetRequestCount: { type: Number, default: 0, select: false },
	resetRequestWindowStart: { type: Date, select: false },
	sessionVersion: { type: Number, default: 0, select: false },
}, opts);
userSchema.index({ isPrimaryAdmin: 1 }, { unique: true, partialFilterExpression: { isPrimaryAdmin: true } });
const websiteSchema = new Schema({ ...owned, name: { type: String, required: true }, url: { type: String, required: true }, description: String, defaultMonthlyHours: { type: Number, min: 0, required: true }, startDate: { type: String, required: true }, status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' } }, opts);
websiteSchema.index({ userId: 1, name: 1 });
const allocationSchema = new Schema({ ...owned, websiteId: { type: Schema.Types.ObjectId, ref: 'Website', required: true }, month: { type: Number, min: 1, max: 12, required: true }, year: { type: Number, required: true }, allocatedHours: { type: Number, min: 0, required: true } }, opts);
allocationSchema.index({ websiteId: 1, year: 1, month: 1 }, { unique: true });
const workLogSchema = new Schema({ ...owned, websiteId: { type: Schema.Types.ObjectId, ref: 'Website', required: true }, date: { type: String, required: true }, description: { type: String, required: true }, category: { type: String, required: true }, hours: { type: Number, min: 0, required: true }, minutes: { type: Number, min: 0, max: 59, required: true }, totalMinutes: { type: Number, min: 1, required: true }, notes: String }, opts);
workLogSchema.index({ userId: 1, websiteId: 1, date: 1 });
workLogSchema.index({ userId: 1, date: 1 });
const auditLogSchema = new Schema({
  ...workspace,
	userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
	userName: { type: String, required: true },
	userRole: { type: String, enum: roles, required: true },
	action: { type: String, required: true, maxlength: 120 },
	resourceType: { type: String, required: true, maxlength: 40 },
	resourceId: { type: String, default: '', maxlength: 80 },
	details: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ createdAt: -1 });
export const User = mongoose.model('User', userSchema);
export const Website = mongoose.model('Website', websiteSchema);
export const MonthlyAllocation = mongoose.model('MonthlyAllocation', allocationSchema);
export const WorkLog = mongoose.model('WorkLog', workLogSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

const workspaceSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
}, opts);
const membershipSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['owner', 'editor', 'viewer'], required: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  joinedAt: { type: Date, default: Date.now },
  lastActive: Date,
}, opts);
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
const invitationSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, trim: true, maxlength: 100, required: true },
  email: { type: String, lowercase: true, trim: true, required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assignedRole: { type: String, enum: ['editor', 'viewer'], required: true },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled', 'expired'], default: 'pending' },
  expiresAt: { type: Date, required: true },
  deliveryStatus: { type: String, enum: ['sent', 'failed', 'sending'], default: 'sending' },
  acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { ...opts, optimisticConcurrency: true });
invitationSchema.index({ workspaceId: 1, email: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
invitationSchema.index({ tokenHash: 1 }, { unique: true });
export const Workspace = mongoose.model('Workspace', workspaceSchema);
export const Membership = mongoose.model('Membership', membershipSchema);
export const WorkspaceInvitation = mongoose.model('WorkspaceInvitation', invitationSchema);
