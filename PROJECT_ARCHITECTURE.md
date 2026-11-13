# Tempo architecture

## Application

React 19/Vite renders the existing dashboard, website cards, calendar, logs, monthly allocations and reports. `src/main.jsx` keeps page navigation and current workspace state. `src/Auth.jsx` handles self-registration, login and recovery. `src/WorkspaceMembers.jsx` handles invitations, membership management, invitation acceptance and workspace naming. Existing CSS and modal/form components remain in use.

`src/api.js` attaches the active tab's `X-Workspace-Id` to JSON requests and downloads. The switcher persists selection through the server, clears data/modals/filter state, and ignores responses initiated for a previous workspace. Panels remount on workspace changes. Workspace metadata returned with data refreshes the displayed role/name.

`shared/tracking.js` still performs integer-minute calculations and validated string-date filtering. All frontend analytics use only the active workspace dataset. Dashboard excludes inactive/future sites; reports retain inactive/historical projects.

`server/app.js` retains auth, CRUD, reports and exports. `server/workspaces.js` implements personal provisioning, legacy upgrade, membership authorization context and collaboration endpoints. `server/email.js` provides SMTP templates with bounded connection/timeouts. `server/index.js` runs locally; `api/index.js` caches the Express app and Atlas connection on Vercel.

## Database

| Model | Fields / constraints |
| --- | --- |
| User | Global identity: name, unique normalized email, optional unique username, private bcrypt/session/recovery fields; `lastWorkspaceId`, `workspaceMigrationVersion`. Legacy role/workspaceId/primary flag retained for migration, not permissions. |
| Workspace | Name, ownerId, timestamps. Personal workspace _id reuses the account _id. Unique ownerId gives each user one personal workspace. |
| Membership | workspaceId, userId, owner/editor/viewer role, active/inactive status, joinedAt, lastActive. Unique workspaceId + userId. |
| WorkspaceInvitation | Name/email, workspaceId, invitedBy, assignedRole, private tokenHash, pending/accepted/rejected/cancelled/expired status, expiresAt, deliveryStatus and acceptedBy. Unique tokenHash; only one pending invitation per workspace/email. |
| Website | workspaceId, creator userId, name/URL/description, startDate, status and defaultMonthlyHours. |
| WorkLog | workspaceId, websiteId, creator userId, date, task/category/notes, hours/minutes/totalMinutes. |
| MonthlyAllocation | workspaceId, websiteId, creator userId, year/month/allocatedHours; unique website/year/month. |
| AuditLog | workspaceId, actor ID/name/role, action, resource identifiers and details. Owner is recorded as admin in this legacy audit enum. |

Passwords and token hashes are excluded from API serialization. Membership removal leaves the global identity, personal workspace, historical creator references and other memberships intact. Website deletion preserves the existing confirmed cascade behavior within the selected workspace.

## Authorization and API

Public routes: `POST /api/auth/register`, `/login`, `/logout`, `/forgot-password`, `/reset-password`, and `GET /api/auth/setup-status`. Registration creates one global identity and its personal Owner membership. Existing secure versioned sessions, rate limiting, recovery expiry/single-use checks and temporary-password change requirements remain.

Authenticated middleware loads the identity and version, provisions/upgrades its personal workspace, selects the requested `X-Workspace-Id` (or remembered/personal fallback), and verifies both workspace existence and active membership. CRUD scopes are exact `{workspaceId}`. Authorization uses `req.membership.role`; global account flags never grant shared access.

| Routes | Behavior |
| --- | --- |
| GET /api/auth/me | Identity plus remembered active workspace/role; invalid remembered membership falls back to personal workspace. |
| GET /api/workspaces | Active memberships with workspace name and role. |
| POST /api/workspaces/:id/select | Validate target membership and remember selection without logout. |
| PUT /api/workspaces/current | Owner rename. |
| GET /api/members | Owner lists members and invitation history. |
| PUT /api/members/:id | Owner changes Editor/Viewer role or membership activation. Owner membership is protected. |
| DELETE /api/members/:id | Owner removes membership, not identity. |
| POST /api/workspace-invitations | Owner sends existing/new recipient an invitation; never creates an account or grants access. |
| POST /api/workspace-invitations/:id/resend | Owner rotates the token/expiry and retries delivery. Old links stop working. |
| DELETE /api/workspace-invitations/:id | Owner cancels a pending invitation. |
| POST /api/invitations/inspect, /accept, /reject | Authenticated recipient email must match and token must be valid/unexpired. Accept consumes pending status conditionally; unique membership prevents duplicate grants. |
| GET /api/data | Active workspace websites/logs/allocations and role/name metadata. |
| Existing website/log/allocation CRUD | Owner/Editor writes, all active members read. Project start-date/history checks unchanged. |
| Existing individual/combined/filtered CSV and Excel exports | All active members, only selected workspace records. |
| GET /api/audit-logs, /backup | Selected workspace Owner only. |

Legacy `/api/users`, `/api/auth/bootstrap` and `/api/auth/claim-owner` workflows return 410. They cannot delete/reset a different identity or create another global owner. Invitation links use `#invitation=...`, stay out of server URL logs, and are redeemed with POST bodies after login/registration. SMTP and APP_URL are server-only. Invite expiry is seven days; recovery expiry remains ten minutes. Failed delivery is exposed as failed, with resend available.

## Migration and operational limits

Provisioning reuses existing workspace IDs, creates unique memberships, preserves explicit data fields, and stamps missing log/allocation workspace IDs through the associated website. Existing recorded legacy team relationships are preserved as memberships; each teammate additionally owns an empty personal workspace. Unknown/missing legacy owner references fail for operator review rather than being silently reassigned.

The bulk migration command defaults to read-only. `--apply` writes an Extended JSON snapshot under `.data/backups` before index/provisioning changes. It never drops collections, removes accounts, copies projects, or overwrites explicit workspace IDs. Repeated runs are tested for idempotency. See DEPLOYMENT_GUIDE.md.

CRUD/audit/cascade writes and invitation consumption/membership creation are separate operations, not cross-collection transactions. A process failure in the small interval after invitation consumption may require the owner to issue a replacement invitation; do not claim full transactional durability. Rate limits are per process; use hosting-wide controls for distributed enforcement. No realtime sync, email-address verification workflow, arbitrary extra-workspace creation, ownership transfer or workspace deletion UI is included. One personal workspace plus invited workspaces matches the requested model.

## SMTP diagnostics

`server/email.js` shares a validated TLS transport between sending and `scripts/verify-email.js`. The CLI verifies connection/authentication without sending mail. Invitation send/resend responses include a transient, fixed `deliveryError` on failure for the Owner UI; raw provider errors and tokens are never returned or persisted. Failed sends retain failed delivery status and grant no membership. Port 465 uses implicit TLS; other ports require STARTTLS. Credentials and APP_URL remain server-only configuration.


## Brevo Transactional Email API (2026-11-13)

The existing invitation and password recovery flows now use Brevo when BREVO_API_KEY is set. Existing SMTP remains available when no Brevo key is configured; a Brevo failure never silently falls back to SMTP. No public general-purpose email endpoint was added. Existing authentication, workspace Owner invitation permissions and rate limits remain in place.

Configure BREVO_API_KEY, BREVO_FROM_EMAIL (an active verified Brevo sender), BREVO_FROM_NAME and EMAIL_TEST_TO privately in .env. Keep APP_URL set to the recipient-accessible application URL and configure MONGODB_URI and a real random JWT_SECRET. Never put credentials in frontend variables or tracked example files. Brevo credentials are not SMTP credentials.

Run `npm.cmd run email:verify` to check API authentication and active sender status without sending; run `npm.cmd run email:verify -- --send-test` to send one test email to EMAIL_TEST_TO. Start both servers with `npm.cmd run dev`, or separately use `npm.cmd run dev:server` and `npm.cmd run dev:client`. Use Workspace Members to invite or resend; recipients sign in and accept the invitation. Provider acceptance does not establish inbox delivery. Check Brevo transactional logs and recipient spam folders.

For deployment, set these values in the backend hosting environment and restart/redeploy after changes. Frontend requests remain same-origin through the Vite /api proxy locally and shared Express/Vercel entry points in production. No production settings or database records were changed.

Live verification: Brevo account authentication and active sender checks passed; one test email was accepted by Brevo. Recipient inbox receipt remains unconfirmed. Production Atlas and deployed invitation delivery remain unverified.
