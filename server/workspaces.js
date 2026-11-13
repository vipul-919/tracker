import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { User, Workspace, Membership, WorkspaceInvitation, WorkspacePresence, Website, WorkLog, MonthlyAllocation, AuditLog } from './models.js';
import { workspaceInvitationEmail } from './email.js';
import { id } from './validation.js';

async function upsert(model, query, values) {
  try { return await model.findOneAndUpdate(query, { $setOnInsert: values }, { upsert: true, new: true, runValidators: true }); }
  catch (error) { if (error.code !== 11000) throw error; return model.findOne(query); }
}

export async function ensurePersonalWorkspace(user) {
  await Promise.all([Workspace.init(), Membership.init(), WorkspaceInvitation.init()]);
  // Reuse the old owner/user ID: existing workspaceId references remain valid.
  const workspace = await upsert(Workspace, { _id: user._id }, { ownerId: user._id, name: `${user.name}'s Workspace` });
  if (String(workspace.ownerId) !== String(user._id)) throw new Error('Personal workspace ownership conflict');
  await upsert(Membership, { workspaceId: workspace._id, userId: user._id }, { role: 'owner', status: 'active' });
  if (user.workspaceMigrationVersion >= 1) return workspace;
  let legacyWorkspaceId = user._id;
  if (user.workspaceId && String(user.workspaceId) !== String(user._id)) {
    const legacyOwner = await User.findById(user.workspaceId);
    if (!legacyOwner) throw new Error('Legacy workspace owner is missing; operator review is required');
    await upsert(Workspace, { _id: legacyOwner._id }, { ownerId: legacyOwner._id, name: `${legacyOwner.name}'s Workspace` });
    await upsert(Membership, { workspaceId: legacyOwner._id, userId: legacyOwner._id }, { role: 'owner', status: 'active' });
    await upsert(Membership, { workspaceId: legacyOwner._id, userId: user._id }, { role: user.role === 'viewer' ? 'viewer' : 'editor', status: user.status === 'inactive' ? 'inactive' : 'active' });
    legacyWorkspaceId = legacyOwner._id;
  }
  // Additive, retryable stamping. Never overwrite a record's explicit workspace.
  const legacy = { userId: user._id, workspaceId: { $exists: false } };
  await Promise.all([Website, AuditLog].map(model => model.updateMany(legacy, { $set: { workspaceId: legacyWorkspaceId } })));
  // Historical logs follow their project, including work entered by a teammate.
  const sites = await Website.find({ userId: user._id }).select('_id workspaceId');
  for (const site of sites) {
    if (!site.workspaceId) continue;
    await Promise.all([WorkLog, MonthlyAllocation].map(model => model.updateMany({ websiteId: site._id, workspaceId: { $exists: false } }, { $set: { workspaceId: site.workspaceId } })));
  }
  await User.updateOne({ _id: user._id }, { $set: { workspaceMigrationVersion: 1 } });
  user.workspaceMigrationVersion = 1;
  return workspace;
}

export async function workspaceContext(user, requestedId) {
  const personal = await ensurePersonalWorkspace(user);
  const selectedId = requestedId || user.lastWorkspaceId || personal._id;
  id.parse(String(selectedId));
  const [workspace, membership] = await Promise.all([
    Workspace.findById(selectedId), Membership.findOne({ workspaceId: selectedId, userId: user._id, status: 'active' }),
  ]);
  if (!workspace || !membership) {
    if (!requestedId) return workspaceContext(user, String(personal._id));
    throw Object.assign(new Error('You do not have access to this workspace.'), { status: 403 });
  }
  if (membership.role === 'owner' && String(workspace.ownerId) !== String(user._id)) throw Object.assign(new Error('Invalid owner membership.'), { status: 403 });
  return { workspace, membership };
}

export function accountPayload(user, context) {
  return { ...user.toJSON(), workspaceId: String(context.workspace._id), workspaceName: context.workspace.name, role: context.membership.role, isPrimaryAdmin: context.membership.role === 'owner' };
}

export function installWorkspaceRoutes(app, { sendMail, appUrl, ownerOnly, audit, invitationLimiter }) {
  const inviteInput = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), role: z.enum(['admin', 'editor', 'viewer']) });
  const inviteHash = token => createHash('sha256').update(token).digest('hex');
  const invitationView = invitation => {
    const value = invitation.toJSON(); delete value.tokenHash;
    if (value.status === 'pending' && new Date(value.expiresAt) <= new Date()) value.status = 'expired';
    return value;
  };
  const sendInvitation = async (req, invitation) => {
    const token = randomBytes(32).toString('base64url');
    invitation.tokenHash = inviteHash(token);
    invitation.expiresAt = new Date(Date.now() + 7 * 86400000);
    invitation.deliveryStatus = 'sending';
    await invitation.save();
    try {
      if (!/^https?:\/\//.test(appUrl)) throw new Error('APP_URL is required');
      const url = new URL(appUrl); url.hash = `invitation=${token}`;
      await sendMail({ to: invitation.email, ...workspaceInvitationEmail({ workspaceName: req.workspace.name, inviterName: req.user.name, role: invitation.assignedRole, url: url.toString() }) });
      await WorkspaceInvitation.updateOne({ _id: invitation._id, tokenHash: invitation.tokenHash }, { $set: { deliveryStatus: 'sent' } });
      invitation.deliveryStatus = 'sent';
    } catch {
      await WorkspaceInvitation.updateOne({ _id: invitation._id, tokenHash: invitation.tokenHash }, { $set: { deliveryStatus: 'failed' } });
      invitation.deliveryStatus = 'failed';
    }
    return invitationView(invitation);
  };

  app.post('/api/workspace-presence', async (req, res) => {
    const { clientId, active } = z.object({ clientId: z.string().uuid(), active: z.boolean() }).parse(req.body);
    const query = { workspaceId: req.workspaceId, userId: req.user._id, clientId };
    if (active) {
      await upsert(WorkspacePresence, query, { ...query, sessionVersion: req.user.sessionVersion || 0, expiresAt: new Date(Date.now() + 35000) });
      await WorkspacePresence.updateOne(query, { $set: { sessionVersion: req.user.sessionVersion || 0, expiresAt: new Date(Date.now() + 35000) } });
    } else await WorkspacePresence.deleteOne(query);
    res.json({ ok: true });
  });
  app.get('/api/workspace-roster', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const [members, invitations, presence] = await Promise.all([
      Membership.find({ workspaceId: req.workspaceId, status: 'active' }).populate('userId', 'name email status +sessionVersion'),
      WorkspaceInvitation.find({ workspaceId: req.workspaceId, status: 'pending' }).select('name email assignedRole expiresAt'),
      WorkspacePresence.find({ workspaceId: req.workspaceId, expiresAt: { $gt: new Date() } }).lean(),
    ]);
    res.json({ workspaceId: String(req.workspaceId), workspaceName: req.workspace.name, role: req.membership.role,
      members: members.filter(m => m.userId && m.userId.status === 'active').map(m => ({
        id: String(m.userId._id), name: m.userId.name, email: m.userId.email, role: m.role, status: 'active',
        online: presence.some(p => String(p.userId) === String(m.userId._id) && p.sessionVersion === (m.userId.sessionVersion || 0)),
      })),
      invitations: invitations.map(i => ({ id: String(i._id), name: i.name, email: i.email, role: i.assignedRole, status: i.expiresAt <= new Date() ? 'expired' : 'pending', online: false })),
    });
  });
  app.get('/api/workspaces', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const memberships = await Membership.find({ userId: req.user._id, status: 'active' }).populate('workspaceId');
    res.json(memberships.filter(m => m.workspaceId).map(m => ({ id: String(m.workspaceId._id), name: m.workspaceId.name, role: m.role, personal: String(m.workspaceId.ownerId) === String(req.user._id) })));
  });
  app.post('/api/workspaces/:id/select', async (req, res) => {
    const context = await workspaceContext(req.user, id.parse(req.params.id));
    await User.updateOne({ _id: req.user._id }, { $set: { lastWorkspaceId: context.workspace._id } });
    res.json(accountPayload(req.user, context));
  });
  app.put('/api/workspaces/current', ownerOnly, async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    req.workspace.name = name; await req.workspace.save();
    await audit(req, 'workspace.updated', 'workspace', req.workspaceId);
    res.json(req.workspace);
  });
  app.get('/api/members', ownerOnly, async (req, res) => {
    const members = await Membership.find({ workspaceId: req.workspaceId }).populate('userId', 'name email lastLogin');
    const invitations = await WorkspaceInvitation.find({ workspaceId: req.workspaceId }).sort({ createdAt: -1 });
    res.json({ members: members.filter(m => m.userId).map(m => ({ id: String(m._id), userId: String(m.userId._id), name: m.userId.name, email: m.userId.email, role: m.role, status: m.status, joinedAt: m.joinedAt, lastActive: m.lastActive || m.userId.lastLogin })), invitations: invitations.map(invitationView) });
  });
  app.put('/api/members/:id', ownerOnly, async (req, res) => {
    const value = z.object({ role: z.enum(['admin', 'editor', 'viewer']).optional(), status: z.enum(['active', 'inactive']).optional() }).refine(v => Object.keys(v).length > 0).parse(req.body);
    const member = await Membership.findOne({ _id: id.parse(req.params.id), workspaceId: req.workspaceId });
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    if (member.role === 'owner' || String(member.userId) === String(req.workspace.ownerId)) return res.status(403).json({ error: 'The workspace owner cannot be downgraded or deactivated.' });
    Object.assign(member, value); await member.save(); await audit(req, 'member.updated', 'membership', member._id, value);
    res.json(member);
  });
  app.delete('/api/members/:id', ownerOnly, async (req, res) => {
    const member = await Membership.findOne({ _id: id.parse(req.params.id), workspaceId: req.workspaceId });
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    if (member.role === 'owner' || String(member.userId) === String(req.workspace.ownerId)) return res.status(403).json({ error: 'The workspace owner cannot be removed.' });
    await member.deleteOne(); await audit(req, 'member.removed', 'membership', member._id);
    // Identity, personal workspace, sessions and other memberships remain intact.
    res.json({ ok: true });
  });
  app.post('/api/workspace-invitations', invitationLimiter, ownerOnly, async (req, res) => {
    const value = inviteInput.parse(req.body);
    if (value.email === req.user.email) return res.status(409).json({ error: 'You already own this workspace.' });
    const existing = await User.findOne({ email: value.email });
    if (existing && await Membership.exists({ workspaceId: req.workspaceId, userId: existing._id })) return res.status(409).json({ error: 'This user is already a member. Manage their existing membership.' });
    await WorkspaceInvitation.updateMany({ workspaceId: req.workspaceId, email: value.email, status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } });
    const invitation = new WorkspaceInvitation({ workspaceId: req.workspaceId, invitedBy: req.user._id, name: value.name, email: value.email, assignedRole: value.role, tokenHash: inviteHash(randomBytes(32)), expiresAt: new Date(Date.now() + 7 * 86400000) });
    const result = await sendInvitation(req, invitation);
    await audit(req, 'invitation.created', 'invitation', invitation._id, { role: value.role });
    res.status(201).json(result);
  });
  app.post('/api/workspace-invitations/:id/resend', invitationLimiter, ownerOnly, async (req, res) => {
    const invitation = await WorkspaceInvitation.findOne({ _id: id.parse(req.params.id), workspaceId: req.workspaceId, status: { $in: ['pending', 'expired'] } }).select('+tokenHash');
    if (!invitation) return res.status(404).json({ error: 'Pending invitation not found.' });
    invitation.status = 'pending';
    const result = await sendInvitation(req, invitation); await audit(req, 'invitation.resent', 'invitation', invitation._id);
    res.json(result);
  });
  app.delete('/api/workspace-invitations/:id', ownerOnly, async (req, res) => {
    const invitation = await WorkspaceInvitation.findOneAndUpdate({ _id: id.parse(req.params.id), workspaceId: req.workspaceId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true });
    if (!invitation) return res.status(404).json({ error: 'Pending invitation not found.' });
    await audit(req, 'invitation.cancelled', 'invitation', invitation._id); res.json({ ok: true });
  });
  const findInvitation = async req => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(req.body);
    const invitation = await WorkspaceInvitation.findOne({ tokenHash: inviteHash(token), email: req.user.email, expiresAt: { $gt: new Date() }, status: { $in: ['pending', 'accepted'] } });
    if (!invitation) throw Object.assign(new Error('Invitation is invalid, expired, cancelled or belongs to another email.'), { status: 400 });
    return invitation;
  };
  app.post('/api/invitations/inspect', invitationLimiter, async (req, res) => {
    const invitation = await findInvitation(req);
    const workspace = await Workspace.findById(invitation.workspaceId);
    const inviter = await User.findById(invitation.invitedBy);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });
    res.json({ ...invitationView(invitation), workspaceName: workspace.name, inviterName: inviter?.name || 'Workspace owner' });
  });
  app.post('/api/invitations/accept', invitationLimiter, async (req, res) => {
    const invitation = await findInvitation(req);
    const workspace = await Workspace.findById(invitation.workspaceId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });
    // A consumed invitation must never restore a removed membership.
    if (invitation.status === 'accepted') return res.status(409).json({ error: 'This invitation was already used.' });
    const claimed = await WorkspaceInvitation.findOneAndUpdate({ _id: invitation._id, status: 'pending', expiresAt: { $gt: new Date() }, tokenHash: inviteHash(req.body.token) }, { $set: { status: 'accepted', acceptedBy: req.user._id } }, { new: true });
    if (!claimed) return res.status(409).json({ error: 'This invitation is no longer pending.' });
    try {
      await upsert(Membership, { workspaceId: workspace._id, userId: req.user._id }, { role: invitation.assignedRole, status: 'active' });
    } catch (error) {
      // Allow retry only if membership creation failed, without resurrecting a cancelled token.
      await WorkspaceInvitation.updateOne({ _id: invitation._id, status: 'accepted', acceptedBy: req.user._id }, { $set: { status: 'pending' }, $unset: { acceptedBy: 1 } });
      throw error;
    }
    await AuditLog.create({ workspaceId: workspace._id, userId: req.user._id, userName: req.user.name, userRole: invitation.assignedRole, action: 'invitation.accepted', resourceType: 'invitation', resourceId: String(invitation._id) });
    res.json({ ok: true, workspaceId: String(workspace._id) });
  });
  app.post('/api/invitations/reject', invitationLimiter, async (req, res) => {
    const invitation = await findInvitation(req);
    const rejected = await WorkspaceInvitation.findOneAndUpdate({ _id: invitation._id, status: 'pending', tokenHash: inviteHash(req.body.token) }, { $set: { status: 'rejected' } });
    if (!rejected) return res.status(409).json({ error: 'This invitation is no longer pending.' });
    await AuditLog.create({ workspaceId: invitation.workspaceId, userId: req.user._id, userName: req.user.name, userRole: invitation.assignedRole, action: 'invitation.rejected', resourceType: 'invitation', resourceId: String(invitation._id) });
    res.json({ ok: true });
  });
}
