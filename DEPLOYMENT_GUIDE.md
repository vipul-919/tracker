# Deployment and migration guide

## Runtime configuration

Use Node 24.x, Vite preset, `npm run build`, output `dist`, and the repository root on Vercel. Keep the existing `api/index.js` function and rewrites. The local persistent MongoDB helper is development-only.

Configure these server-side variables privately:

- `MONGODB_URI`: intended Atlas database, with database-scoped credentials and network access for Vercel. Never localhost in production; use a separate preview database.
- `JWT_SECRET`: stable random value of at least 32 characters. Rotating it signs everyone out.
- `APP_URL`: canonical HTTPS application URL, currently https://tracker-two-wine.vercel.app/ for the existing site. Invitation links use this address.
- `NODE_ENV=production` for secure cookies over HTTPS.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and optional `SMTP_FROM_NAME`: the provider connection and authorized sender. Port 465 uses implicit TLS; other ports use STARTTLS when supported.

`ADMIN_BOOTSTRAP_TOKEN` is no longer used. Every authenticated account owns its personal workspace. No owner-token setup or hardcoded owner email is needed. Do not change production variables without the owner's approval. Vercel variable changes require a new deployment. Never use VITE_ prefixes for secrets.

## Existing-data migration plan

The schema change is additive. Users and project records keep their IDs and passwords. Personal Workspace IDs reuse User IDs, so prior explicit workspaceId fields remain valid. Memberships have a unique workspace/user index. New code no longer reads User.role or isPrimaryAdmin for permissions.

On sign-in/authenticated use, provisioning creates the account's personal Workspace and Owner membership. For an old team account with an explicit foreign User.workspaceId, the recorded old team relationship is preserved separately as Editor/Viewer; it also receives its own personal workspace. Existing inactive identities remain inactive. New invitations always require explicit acceptance.

Missing website workspace IDs are stamped using recorded legacy ownership. Missing work-log/allocation IDs follow their website, including entries made by another teammate. Explicit workspace IDs are never overwritten. Missing legacy owner references fail for operator review. Orphan records whose website/creator cannot be established are not deleted or guessed into another tenant; inspect them separately.

A bulk upgrade is available when the operator has authorized database access:

```powershell
node scripts/migrate-workspaces.js
```

This defaults to a read-only preview: counts and pending accounts only. It disables automatic collection/index creation during preview. Verify the target MONGODB_URI privately and review the output before applying. No live production migration was executed from this development environment.

```powershell
node scripts/migrate-workspaces.js --apply
```

Before any upgrade writes, apply saves an Extended JSON snapshot of users, workspaces, memberships, invitations, websites, work logs, allocations and audit logs under `.data/backups/before-workspaces-*.ejson`. It contains private password/token hashes; keep it out of Git and protect it with filesystem permissions. Apply creates only the new indexes (no drops/syncIndexes), then runs the same repeatable per-account upgrade. A failed run is safe to inspect and retry; it does not reset records or duplicate personal workspaces/projects.

Use an Atlas snapshot / operational database backup and a maintenance window for production backup consistency. The CLI's sequential snapshot is a recovery artifact, not a point-in-time database snapshot during concurrent writes. Any database restore or destructive migration requires separate authorization. The former `scripts/upgrade-owner.js` now only explains the replacement workflow and does not mutate ownership.

## Invitations and live acceptance checks

Registration works without SMTP. Invitation delivery and password recovery require real SMTP. If SMTP or APP_URL is missing, the owner sees a failed-delivery invitation and can resend after configuration. No account is created and no access is granted merely by inviting an address.

1. Register three authorized test identities against a non-production database; each should see only its personal workspace as Owner.
2. Person 1 invites Person 2 as Editor and Person 3 as Viewer. Check delivered emails and links; recipients accept with the matching email account.
3. Switch Person 2 into Person 1's workspace: project/log/allocation writes work. Switch back: only personal data appears and Workspace Members returns.
4. Switch Person 3 into Person 1's workspace: read/export works and direct POST/PUT/DELETE requests return 403.
5. Invite Person 1 from Person 2's personal workspace. After acceptance, Person 1 is Owner personally and Editor there.
6. Check reject, expiry, resend-token rotation and cancellation. Changing/removing a membership must not affect the account, personal workspace or unrelated memberships.
7. Verify individual, combined and filtered CSV/Excel exports contain only the selected workspace. Check mobile switching and last-selection persistence.
8. Verify ten-minute single-use password recovery, logout/session invalidation and pre-existing temporary-password changes.

## Operational limits

Vercel success establishes that the release built and deployed, not that a user's private Atlas records or inbox delivery were inspected. Local tests use isolated real MongoDB instances with an injected email sender. Real SMTP remains separately verifiable with owner-provided configuration.

Rate limits are in-process. Configure deployment-wide limits through a shared store or hosting controls for public signup. Cross-collection CRUD/audit and invitation-grant operations are not MongoDB transactions; a hard process failure during a grant can require a replacement invitation. No account deletion/reset powers are granted to workspace owners. Backups in the app remain selected-workspace JSON exports; they do not implement an account restore UI.
