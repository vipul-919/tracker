# Current project status: collaborative multi-workspace

## Completed implementation

- Every new registration gets one independent personal workspace and Owner membership. Existing authenticated accounts are upgraded without owner tokens or changed passwords.
- Workspace, Membership and WorkspaceInvitation models are added. Roles are membership-specific; legacy global Admin flags do not grant permissions in another workspace.
- Existing/new recipients can receive a seven-day email invitation, sign in/register, and accept or reject. Invitations store only token hashes; resend rotates tokens, expiry/cancellation blocks redemption, and duplicate/concurrent acceptance does not duplicate memberships.
- The sidebar switcher lists each active workspace with its role and remembers selection. JSON requests and report downloads carry validated workspace context. Data/modals/filter state reset on switching, and stale requests from the previous workspace are ignored.
- Workspace Members supports role/status filtering, invitation status and delivery feedback, joined/last-active dates, role changes, membership deactivation/reactivation/removal, resend, cancellation and workspace audit history. The Owner cannot be removed or downgraded through member APIs.
- Existing website/work-log CRUD, calendar, integer-minute allocations, dashboards, monthly/yearly reports and CSV/Excel exports remain scoped to the active workspace. Viewers retain downloads and cannot modify data through direct APIs.
- Workspace settings support naming, existing password change/theme and selected-workspace backup. Membership owners cannot delete/reset someone else's login account or modify its other memberships.
- Legacy upgrade reuses IDs, preserves recorded sharing and explicit workspace IDs, and stamps historical child records through their website. A read-only bulk preview and backup-before-apply command are implemented and tested for repeatability.
- The earlier global owner-bootstrap and manual password-sharing workflows are superseded by self-registration plus invitation acceptance. Old account-management/bootstrap routes return 410. Existing temporary accounts still must change passwords at first sign-in.

## Verification

All 25 Node tests pass and the production build passes. Browser checks pass registration, invitations to existing/new users, reciprocal sharing, membership-specific controls, switching/remembered selection, delayed old-response isolation, Viewer direct API denials, CRUD, calendar, reports, exports, theme and mobile layout. The final run includes legacy accounts missing status/session-version fields and backup-before-apply idempotency.

All test databases are isolated; no configured application database was reset or populated with test data. The migration preview/apply/backup tests run only against throwaway MongoDB. No lint script exists; lint cannot be reported as passing.

## Configuration / external verification required

- Real SMTP and canonical APP_URL are required for delivered invitations and recovery. Tests inject an email sender and verify failed delivery behavior; inbox delivery is not established.
- The local application database previously did not respond. Production Atlas data has not been inspected or bulk-migrated from this environment. Review/backup the intended database using DEPLOYMENT_GUIDE.md; first authenticated use performs additive per-user provisioning.
- Production environment changes still require approval. No bootstrap token is required by the new model.
- Deployment-wide rate limits and operational Atlas backups remain deployment responsibilities. In-process limits and sequential EJSON backup do not establish distributed limits or point-in-time consistency.

## Known limits

- One personal workspace per account, plus invited workspaces; no UI for arbitrary additional workspaces, ownership transfer or workspace deletion was requested/added.
- Shared edits appear on refresh; no realtime push synchronization.
- Multi-document CRUD/audit and invitation-grant sequences do not use MongoDB transactions. Ordinary API failure recovery and concurrent acceptance are tested; hard process-crash recovery may need an owner-issued replacement invitation.
- Missing legacy ownership references/orphan records require operator review; the migration preserves them rather than guessing or deleting.
- Global email uniqueness remains the identity invariant. No email verification workflow or in-app backup restore is implemented.

See PROJECT_ARCHITECTURE.md for schemas/API boundaries and DEPLOYMENT_GUIDE.md for the safe rollout plan.
