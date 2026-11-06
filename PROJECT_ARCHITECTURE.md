# Tempo architecture

## Runtime and source structure

Single npm project, ES modules, Node 24.x. `src/main.jsx` mounts React directly and holds App, Auth, PasswordChange, Dashboard, Websites, Calendar/MonthCalendar, Logs/LogTable, Reports, UserManagement/UserForm, Settings, account password form, and modal/form components. Page navigation and state use React hooks rather than a router. `src/styles.css` contains the existing responsive light/dark design; `src/api.js` wraps same-origin JSON requests and file downloads.

`shared/tracking.js` provides categories, local calendar date keys, minute-based duration/allocation/monthly calculations, report filtering, and CSV escaping. Actual work is stored in integer minutes. Dates are validated strings to avoid UTC shifts. Monthly targets use a default plus an optional website/year/month override, including zero. Dashboard excludes inactive and not-yet-started websites; reports include inactive websites.

`server/app.js` exports an injectable Express factory. Tests inject an email sender; normal runtime uses `server/email.js` and Nodemailer. `server/validation.js` validates requests with Zod. `server/index.js` connects MongoDB and serves Express plus dist on localhost. `api/index.js` runs the same API on Vercel, caches its connection promise, retries failed connections, and returns generic JSON 503 responses for initialization errors. Vercel serves dist separately and rewrites API requests to the function. Vite proxies `/api` to port 3001 during development.

`scripts/setup.js` preserves existing env values and appends missing keys. `scripts/local-db.js` runs persistent development MongoDB under `.data/mongodb`; it is not a production service. `scripts/browser-check.js` runs browser workflows against an isolated database. `tests/` contains shared calculation/validation, API integration, and Vercel adapter tests. `node_modules`, `dist`, `.data`, and secret env files are ignored.

## Data model

| Collection/model | Main fields and relationships |
| --- | --- |
| User | Name, unique normalized email, optional unique username, bcrypt hash, role, status, primary-owner flag, forced-change flag, last login, private session version and recovery metadata. Partial unique index allows only one primary Admin. |
| Website | Creator userId, name, URL, description, defaultMonthlyHours, startDate, Active/Inactive status. |
| WorkLog | Creator userId, websiteId, date, description, category, hours, minutes, totalMinutes, notes. Indexed by user/website/date. |
| MonthlyAllocation | Creator userId, websiteId, month, year, allocatedHours. Unique website/year/month index. |
| AuditLog | Actor ID, name and role snapshot, action, resource type/ID, details, createdAt. Indexed by timestamp. |

Each member has workspaceId equal to the owner account ID. New websites, logs, allocations and audit entries store that workspaceId. All workspace queries use the authenticated membership. Historical records without workspaceId remain visible only when their creator belongs to that workspace; unrelated legacy accounts are not silently merged. Historical `userId` fields retain creator identity. Website deletion intentionally cascades to its logs and allocations after UI confirmation; user deletion leaves shared work records intact. References are Mongoose ObjectIds rather than database foreign keys. JSON transforms omit password hashes, recovery fields, and session versions. JSON backup contains workspace data, not users or audit history, and has no in-app restore.

## API and permission map

| Routes | Access and behavior |
| --- | --- |
| GET /api/auth/setup-status | Public owner/bootstrap availability, no secret values. |
| POST /api/auth/bootstrap | One-time token-verified primary Admin initialization; can promote an existing account with the supplied email. |
| POST /api/auth/register | Always denied; accounts are Admin-created. |
| POST /api/auth/login, /logout, /forgot-password, /reset-password | Login, version-invalidating logout, generic recovery request, atomic recovery-code consumption. |
| GET /api/auth/me; POST /api/auth/change-password | Authenticated account; forced-change accounts cannot access workspace routes. |
| /api/users; /api/users/:id; POST /api/users/:id/reset-password | Owner-only user CRUD and temporary-password reset, with primary-owner and self-lockout protection. |
| GET /api/audit-logs; GET /api/backup | Owner-only audit history and workspace JSON export. |
| GET /api/data | All authenticated roles; websites, logs, allocations loaded together. |
| POST/PUT/DELETE /api/websites and /:id | Admin/Editor CRUD. Start-date edits cannot invalidate existing logs. |
| POST/PUT/DELETE /api/logs and /:id | Admin/Editor CRUD; 1 minute through 24 hours per entry, on/after website start. |
| PUT /api/allocations; DELETE /api/allocations/:id | Admin/Editor overrides and default restoration. |
| GET /api/websites/:id/export/csv or xlsx | All roles; complete individual history. |
| GET /api/export/all/csv or xlsx | All roles; combined history; Excel includes Summary, project worksheets, and All Work Logs. |
| GET /api/export/csv or xlsx | All roles; websiteId, category, from, to filters. |

Mutations require `X-Requested-With: Tempo`. Helmet applies response headers; sessions use signed HS256 JWTs in HttpOnly, SameSite Strict cookies (Secure in production). Every authenticated request reloads the user and checks activation and session version. Auth/recovery routes have in-process rate limits; recovery has additional stored counters. SMTP environment variables remain server-only. Excel names are sanitized/deduplicated; CSV cells escape formulas and quotes. No realtime sync or server-side pagination is implemented: clients reload workspace data after their own writes.

## Dependency snapshot

Resolved package-lock versions at handover: React 19.3.1, Vite 7.3.7, Express 5.3.0, Mongoose 8.24.8, bcryptjs 3.0.3, jsonwebtoken 9.0.3, Nodemailer 10.3.1, ExcelJS 4.4.0, Zod 4.6.7, Playwright Core 1.64.1, mongodb-memory-server 10.4.3. package.json declares compatible version ranges; use `npm ci` to reproduce the lockfile. Fonts load from Google Fonts with local fallbacks. No dependencies were added during this handover.

## Owner access update

User Management and Settings navigation require isPrimaryAdmin, with an additional API check that the owner ID equals workspaceId. New members are Editor or Viewer; an existing non-owner admin no longer has user management access. Login accepts email or globally unique username. Manual account creation does not require SMTP: the owner already knows the submitted password, and only transient React state displays it once. Password reset returns a freshly generated temporary password once to the authenticated owner with Cache-Control: no-store. Password hashes and existing passwords are never retrievable. Optional invitation failure preserves the account for manual sharing.

POST /api/auth/claim-owner upgrades the signed-in existing account only when no primary owner exists and a server-configured ADMIN_BOOTSTRAP_TOKEN is verified. It preserves the password and user ID and renews the session. The owner setup banner appears for an uninitialized deployment. An operator can instead use scripts/upgrade-owner.js with a reviewed dry run and explicit --apply; it stamps only that account and its owned legacy records.
