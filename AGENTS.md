# Development instructions

This is Tempo, an existing React/Vite + Express + MongoDB work-hours tracker. Preserve its design, integer-minute calculations, calendar dates, reports and exports.

- Read PROJECT_STATUS.md and PROJECT_ARCHITECTURE.md. Inspect Git status; preserve existing work and use an isolated branch for substantial changes. Commit/deploy only with user authorization.
- The current model is collaborative multi-workspace. Every account owns a personal workspace. Owner/Editor/Viewer roles come from Membership, never the legacy User.role or isPrimaryAdmin fields. A user's role in one workspace has no effect elsewhere.
- Authenticate identity, verify workspace and active membership, then enforce membership role and record workspaceId on every workspace API. Owners alone manage members/settings/audits/backups. Editors write project data; Viewers read/export. Invitation acceptance is a separate recipient-and-token-verified grant.
- Personal workspace IDs reuse User IDs for backward compatibility. Existing explicit workspaceIds are preserved. The repeatable legacy migration stamps missing website fields and links logs/allocations through their website. Preserve recorded legacy shared access; do not infer new memberships from an email or global Admin flag.
- Do not delete application records, reset a database, run destructive migrations or change production configuration without explicit authorization. Automated tests use isolated MongoDB instances and may CRUD there. The bulk migration defaults to read-only and backs up before explicit --apply.
- Never print/commit env values, connection strings, passwords, cookies or invitation/recovery tokens. Only hashes persist for tokens. Invitation links use a URL fragment and authenticated POST redemption. Failed SMTP must not grant membership or fabricate successful delivery.
- Keep account identities independent. Workspace owners cannot reset another account's password, delete it, or modify its other memberships. Removing/deactivating a member affects only that workspace. Existing temporary accounts still must change password at first login.
- The frontend sends X-Workspace-Id on JSON requests and downloads. Validate it server-side. Clear workspace state and invalidate in-flight data responses on switch; retain per-tab context and persist the last selection on the account.
- Keep shared createApp local/Vercel entry points. No VITE_ secrets or localhost production database. ADMIN_BOOTSTRAP_TOKEN is obsolete; personal ownership needs no token.
- Run npm.cmd test, npm.cmd run build, and relevant npm.cmd run test:browser. Use npm on other shells. Browser tests require installed Chrome/Edge; Mongo binaries/screenshots/backups live under ignored .data. No lint script exists; report that honestly.
- Windows Git may require C:/Program Files/Git/cmd/git.exe. Vite/esbuild may require sandbox escalation for parent-directory reads. Do not confuse access restrictions with application defects.
- Isolated tests do not verify production Atlas, live SMTP delivery or deployed account/data migration. Record actual results and remaining configuration requirements in the project documents.
