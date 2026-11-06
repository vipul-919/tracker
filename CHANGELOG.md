# Changelog

## 2026-11-06 - Codex development handover

Baseline: `4b6bb1e`; checkpoint branch `codex/handover-stabilization`. Initial audit completed before application code changes. Existing stack, design, features, application data and env values preserved. No dependencies added; no production changes or deployments performed.

### Changes

- Return safe JSON 503 responses for missing Vercel JWT/database configuration instead of module-load failure. Avoid raw connection-error details in local startup and Vercel logs.
- Give all Admin accounts the requested user/audit/backup/settings access. Protect primary-owner details from other Admins and prevent Admin self-lockout/deletion.
- Atomically consume recovery codes, increment failed attempts, avoid stale failed-email cleanup, and invalidate pending codes when a password changes or an Admin issues a temporary password.
- Invalidate account sessions on logout; copied cookies cannot be replayed after successful logout. This signs the account out on all devices.
- Add password change to Admin Settings and refresh the active identity after self-edits in User Management.
- Prevent moving a website's start date past existing work logs.
- Support reserved, quoted, colliding and long website names in combined Excel worksheet generation.
- Ignore additional secret env file variants while retaining `.env.example`.
- Add regression tests, extend browser checks for password settings and assigned Admin access, and wait for the audit view before assertions.
- Add AGENTS.md, PROJECT_STATUS.md, PROJECT_ARCHITECTURE.md and DEPLOYMENT_GUIDE.md; update README role behavior, Node version and session documentation.

### Validation

- All 15 Node tests pass (13 baseline tests plus regression groups).
- Production frontend build passes. The first sandboxed build failed on filesystem access; the authorized retry succeeded.
- Extended browser suite passes, including Settings password change and assigned Admin navigation/audit access/owner-edit protection. An earlier run exposed an existing async audit assertion; a heading wait fixed it.
- Node syntax checks and Git whitespace checks pass. No lint script exists; lint was attempted and cannot run.
- Read-only connection to the configured localhost MongoDB did not succeed. Real Atlas/Vercel/SMTP and production owner setup remain unverified.

See PROJECT_STATUS.md for remaining scope, dependencies, and acceptance requirements.

## Owner-only access-management update

- Supersedes the earlier all-Admin management policy with the original owner as the only user/access/settings manager. New member roles are Editor and Viewer.
- Adds workspaceId fields, scoped reads/writes/user actions/audit/backups/exports, and scoped fallback for owned legacy records. Unrelated legacy accounts are not merged.
- Manual account creation works without SMTP; invitation delivery is optional and failure no longer deletes the account.
- Adds transient one-time credential cards, Copy Credentials, Login ID column, role filtering, and email-or-username sign-in. Newly generated reset passwords can be shared manually; existing passwords remain inaccessible.
- Adds a server-token-verified website flow to upgrade the logged-in original account without recreating credentials, plus an operator dry-run/apply helper. The live owner account has not been modified.
- Adds isolated tests for owner claim, manual account creation, failed invitations, username login, cross-workspace API/export isolation, owner protections, reset invalidation and recovery concurrency.
- Validation: all 19 Node tests pass; production build passes; browser checks pass, including manual creation, Copy Credentials, dismissal and role filtering. Lint remains unavailable because the project has no lint script. The configured local database dry run failed to connect and made no changes.
