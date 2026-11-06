# Project status: development handover

Audit date: 6 November 2026. Baseline: `main` at `4b6bb1e` (Add role-based user management and recovery). Development branch: `codex/handover-stabilization`. The initial working tree was clean. No existing work was reset, no commits or pushes were made, and no production configuration was changed.

## Discovery evidence

All tracked application source, configuration, scripts, tests and README were inspected before application edits. Git showed only local main and origin/main, with three commits: initial tracker, website autocomplete/project exports, then roles/recovery. This supports the conclusion that the latest work concerned user management, bootstrap, recovery, and deployment documentation; it does not establish Copilot's private intentions. No TODO/FIXME/HACK implementation markers were found. Generated dist, dependencies, and persistent local data were not treated as application source or edited manually.

## Completed

| Feature | Implementation and verification |
| --- | --- |
| Website management | `src/main.jsx`, `server/app.js`, `server/models.js`: CRUD, search/status filters, activation, start dates and default monthly hours. API and browser CRUD tests pass. |
| Daily work and categories | Calendar/day dialogs, searchable website picker, logs, notes, edit/duplicate/delete; integer-minute validation and start-date checks. API and browser tests pass. |
| Allocations and summaries | Monthly default/overrides, zero targets and reset-to-default; dashboard allocated/actual/remaining/overage, cumulative chart. Calculation tests cover month/year isolation. Browser covers target changes and dashboard totals. |
| Historical reports | Daily, weekly, monthly, yearly and custom filters; website/category/day charts and tables. API export and calculation tests verify date boundaries and historical records. Browser covers monthly/custom reports. |
| CSV and Excel | Filtered, individual, combined history; inactive records included; escaping, headers, worksheet summaries and name handling. Generated Excel files are parsed in tests, with UI downloads checked in browser. |
| Authentication | Token-protected one-time owner initialization, bcrypt login, HttpOnly versioned sessions, forced temporary-password change, logout, deactivation and password reset invalidation. API tests include copied-cookie rejection after logout. |
| Role enforcement | Admins manage users/audits/backups/data; Editors manage data; Viewers read/export. Direct API Viewer POST/PUT/DELETE denials are tested for websites, logs and allocations. Primary owner cannot be deleted/downgraded/deactivated or edited by another Admin. |
| User management | Admin account creation, name/email/username edits, roles/status, deletion, emailed temporary resets, audit history. API tests cover non-primary Admins as well as the owner. |
| Recovery implementation | SMTP-backed templates, generic requests, hashed eight-digit code, 10-minute expiry, five-attempt limit, single-use atomic consumption. API tests cover replacement, expiry, reuse, concurrent valid submissions, and invalidation by password changes/Admin resets. Real SMTP delivery remains external configuration work. |
| Admin account settings | Existing account display/theme/backup plus current-password-verified password change. Owner details can be edited in User Management and update the active UI identity. |
| Deployment source | Vite build and Vercel adapter tested locally. Missing URI/JWT produces generic JSON 503; warm database connection is reused. This verifies the adapter, not a live Vercel deployment. |

## Partially Completed

| Area / relevant files | Existing behavior, remaining work, dependencies and testing |
| --- | --- |
| Production readiness: `api/index.js`, `vercel.json`, `.env.example` | Deployment code and isolated tests exist. Atlas/Vercel environment, deployed route behavior and primary-owner state have not been inspected. Requires the owner's Vercel/Atlas access and approval for changes; follow DEPLOYMENT_GUIDE.md acceptance checks. |
| Email: `server/email.js`, `server/app.js` | Templates and injection-tested delivery paths exist. Local SMTP settings are empty and external delivery is unverified. Requires provider host/port/credentials and authorized sender. Verify invitation, recovery, password-change and deactivation delivery with a real inbox. |
| Distributed rate limits: `server/app.js` | Auth/recovery IP limits use instance-local memory; recovery also has stored account counters. Multiple Vercel instances do not share IP limits. Add a shared rate-limit store or hosting firewall rule with deployment approval, then test across instances. Stored request counters are not a fully atomic distributed quota. |
| Multi-document write durability: `server/app.js` | CRUD, cascading website deletion and audit creation are separate writes, not transactions. Tests cover normal behavior; partial failure recovery is not verified. A future transaction design needs a replica-set database and deliberate failure-injection tests. Do not run destructive migrations. |

## Not Implemented

| Area / files | Scope and follow-up |
| --- | --- |
| Lint tooling: `package.json` | No lint script, linter dependency or configuration. `npm.cmd run lint` fails with Missing script. Define a project lint policy and add a real linter if requested; syntax checks/build are not substitutes. |
| In-app backup restore: `src/main.jsx`, `server/app.js` | JSON export contains websites/logs/allocations, not a complete account/audit backup. No restore API/UI. Use authorized Atlas/database backups for operational recovery; implementation needs format validation, conflict rules and explicit restore approval. |
| Email verification, timers, realtime synchronization | Not present and not required by this handover. Workspace data reloads after the client's own changes; another user's edits require a refresh. |

## Broken / Needs Fixing

The following established defects were fixed in this branch:

| Baseline defect / root cause | Change and regression verification |
| --- | --- |
| Vercel module crashed on missing JWT before handler catch (`api/index.js`) | Catch factory initialization at module load; handler returns JSON 503. Tests import without JWT and test missing URI separately. Logs use safe configuration categories. |
| Assigned Admins blocked by primary-owner-only middleware and navigation (`server/app.js`, `src/main.jsx`) | Admin role grants management/audit/backup/settings access; preserve protected owner details and prevent self-deletion/downgrade/deactivation. Direct API regression coverage added. |
| Concurrent recovery requests could both consume a valid code (`server/app.js`) | Conditional atomic update includes exact code, expiry, attempt count and session version; only one of two concurrent requests succeeds. Failed guesses use atomic increments. |
| Earlier recovery code survived Admin/normal password change (`server/app.js`) | Clear code and expiry on those changes. Failed mail cleanup removes only its own matching code. API tests reject stale codes. |
| Logout only removed the browser cookie (`server/app.js`) | Increment account session version before cookie removal. Copied cookies no longer authenticate. All sessions for the account are invalidated. |
| Start-date edits could invalidate existing log history (`server/app.js`) | Reject edits that move startDate past existing work logs with 409 and preserve the website. Regression test checks rejection and stored date. This is an application guard, not cross-document transaction isolation. |
| Excel rejected reserved/edge-quoted worksheet names (`server/app.js`) | Sanitize control characters, edge apostrophes, reserved History, length and collisions. Regression test loads the workbook for reserved, duplicate and long names. |
| No post-onboarding password form (`src/main.jsx`) | Add Admin Settings form with current password, confirmation, busy/error/success states and renewed session. |
| Browser audit assertion could run before fetch completed (`scripts/browser-check.js`) | Wait for audit heading before checking actions; no arbitrary delay added. |

No claim is made that an exhaustive security audit or concurrency proof was completed. Ordinary API CRUD and audit writes retain the transaction limitation described above.

## Production Configuration Required

- **Local database:** configured localhost connection did not respond. No application database documents, owner status or existing local data could be verified. Start the installed service/development helper or configure an authorized development Atlas URI, then retry a read-only connection check.
- **Local bootstrap:** ADMIN_BOOTSTRAP_TOKEN is absent/empty. `npm.cmd run setup` can append a generated token without overwriting existing values; the owner must privately choose account details and initialize through the UI. APP_URL is also missing locally.
- **Local mail:** SMTP host, port, user, password and sender are absent/empty. Supply provider settings privately. No credentials should be pasted into chat or committed.
- **Vercel/Atlas:** presence and validity of JWT_SECRET, remote URI, bootstrap token, SMTP and APP_URL are unknown. The previously reported missing-JWT/localhost-production problem cannot be declared resolved without deployed evidence. Correct settings and redeploy with approval, then verify the actual HTTPS site.

## Verification results

- Baseline: all 13 existing Node tests passed.
- Updated: all 15 tests passed, including real isolated MongoDB CRUD, Viewer API restrictions, owner/Admin controls, recovery expiry/reuse/concurrency, CSV/Excel content and Vercel initialization.
- `npm.cmd run build`: passed after sandbox escalation; the initial sandbox attempt failed reading parent directories in esbuild.
- Extended browser suite: passed desktop, dark mode, mobile navigation/layout, owner setup, user creation, Viewer permissions, CRUD, calendar, reports and downloads, plus Settings password change and assigned Admin access/owner-edit protection.
- `npm.cmd run lint`: unavailable (missing script). Changed JavaScript passes Node syntax checks; build parses JSX.
- Configured application database connection: unsuccessful; isolated tests do not verify that database or production Atlas.
- Real SMTP, production owner state, live Vercel routing and cross-instance rate limits: not verified.

## Remaining implementation/deployment order

1. Configure/reach the intended development database and initialize the primary Admin privately if no owner exists.
2. Configure SMTP and verify real invitation/recovery delivery.
3. With owner approval, inspect/correct Vercel and Atlas settings, deploy this branch, remove bootstrap token after setup, and run live acceptance checks.
4. Add deployment-wide rate limits and define operational backup/restore procedures before broad exposure.
5. Add a lint policy and consider transaction-based audit/cascade consistency if deployment requirements demand it.
