# Tempo — Website Work Hours Tracker

A full-stack React, Express, and MongoDB application for managing website allocations and daily work in one shared workspace with Admin, Editor, and Viewer roles.

## Quick start (Windows PowerShell)

Install Node.js **22.12 or newer**. In this directory:

```powershell
npm.cmd install
npm.cmd run setup
```

`setup` creates `.env` with random session and one-time owner-bootstrap secrets and preserves existing configuration. In PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running.

Choose a MongoDB connection:

- **Installed MongoDB Community:** start its local service, using the default connection below.
- **MongoDB Atlas:** set `MONGODB_URI` in `.env` to your connection string. Configure database credentials and network access in Atlas.
- **Convenient local development:** run `npm.cmd run db` in a separate terminal. This downloads and runs a real MongoDB binary; the first run needs internet access. Records persist under `.data/mongodb` across restarts. Leave that terminal open. Do not run this alongside another database on port 27017. This helper is for development; use a managed or installed MongoDB service in production.

Then run:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173** and select **Set up primary Admin**. Enter `ADMIN_BOOTSTRAP_TOKEN` from `.env` to initialize the single owner account. Public registration is disabled. Configure SMTP before inviting users or sending password recovery codes. The Express API listens on port 3001; Vite proxies `/api` to it.

On other shells use `npm` instead of `npm.cmd`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API / production HTTP port (default 3001). |
| `MONGODB_URI` | MongoDB connection, default `mongodb://127.0.0.1:27017/work-hours-tracker`. |
| `JWT_SECRET` | Random secret of at least 32 characters. Generate with `npm run setup`. |
| `ADMIN_BOOTSTRAP_TOKEN` | One-time secret used to create the primary Admin when no owner exists. Remove it after owner setup. |
| `APP_URL` | Application sign-in URL included in account invitation emails. |
| `NODE_ENV` | `development` locally; `production` enables secure cookies and production security headers. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Private SMTP connection settings for invitations and password recovery. |
| `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Sender identity for automated emails. |

Do not commit `.env`, database files, or downloaded backups.

## Build and run

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3001** for a local production build. For a deployment, set `NODE_ENV=production` and serve HTTPS through a reverse proxy to `127.0.0.1:3001`. Authentication cookies are marked `Secure` in production and require HTTPS. This project is not deployed automatically.

## Hosting on Vercel

Vercel serves the Vite build and routes `/api/*` to `api/index.js`, which reuses the Express application and a cached MongoDB connection pool. Local development still uses `server/index.js`. The API and frontend share a domain; no frontend API URL or CORS configuration is necessary.

The project pins Node.js 24.x and skips the development MongoDB binary download during dependency installation. `npm run db` and integration tests download the binary on first use instead; Vercel uses Atlas and does not need a local MongoDB binary.

1. Create a MongoDB Atlas cluster, a database user with read/write access to the application database, and configure Atlas Network Access to allow your Vercel deployment to connect. With dynamic outbound IPs, use the Atlas/Vercel integration or configure an appropriate network access rule. Allowing `0.0.0.0/0` admits connections from any IP, so use strong database credentials and database-scoped permissions if choosing that option.
2. Copy the Atlas **Drivers / Node.js** connection string, specifying the `work-hours-tracker` database. Replace credential placeholders; URL-encode special characters in the password.
3. Push this project to GitHub. Keep `.env`, `.data`, and `node_modules` out of Git; `.gitignore` covers them.
4. In Vercel, choose **Add New → Project**, import the repository, and use the repository root with the **Vite** preset. Build command: `npm run build`. Output: `dist`. Select Node.js 24.x in project settings.
5. Add server-side environment variables for Production (and Preview if needed): `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `ADMIN_BOOTSTRAP_TOKEN`, `APP_URL`, and the SMTP variables. Generate secrets with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Never prefix secrets with `VITE_`.
6. Deploy, open the HTTPS URL, and initialize the primary Admin with `ADMIN_BOOTSTRAP_TOKEN`. Remove that token from Vercel after owner setup, then redeploy. Configure valid SMTP credentials before creating users or enabling password recovery.
7. Verify the owner can create an Editor and Viewer, and confirm the Viewer can export reports but cannot change data.

Do not use `npm run db`, a localhost MongoDB URI, or `npm start` as Vercel build commands. Vercel runs the API function automatically. Your local records are separate from Atlas unless migrated. Preview deployments using the same Atlas URI share production data; use a separate database for previews if needed.

For a 503 API response, check Vercel Function logs for missing environment variables, Atlas credentials, or Atlas network-access restrictions. The built-in authentication rate limiter is per function instance; configure Vercel Firewall rate limits or a shared rate-limit store for deployment-wide limits. This repository contains the deployment configuration; an actual Vercel deployment still requires your Vercel account and Atlas setup.

## Accounts and roles

All accounts share one workspace. Admins can manage users, change roles, review audit logs, and manage workspace data. Editors can manage websites, allocations, and work logs. Viewers can read workspace data and download reports but cannot modify it. API routes enforce these permissions independently of the frontend.

The first owner is initialized through a one-time bootstrap token; public self-registration is disabled. User invitations include a temporary password and require a password change at first sign-in. Password recovery codes are hashed in MongoDB, expire after 10 minutes, are single-use, and are rate limited. Email delivery requires the server-only SMTP environment variables above. Never store SMTP credentials or bootstrap tokens in frontend variables.

## Features

- Dashboard: active websites, monthly allocation, actual and remaining time, completion percentage, website progress, cumulative work-versus-target chart, recent logs, over-target and under-target summaries.
- Website management: add, edit, search, filter, activate/deactivate, and delete with confirmation. Deleting a website also deletes its work logs and allocations.
- Calendar: custom accessible React calendar with 12-month annual view, detailed monthly view, year navigation, daily totals, today marker, and clickable dates. Open any date to see and edit entries or add multiple work logs.
- Work logs: searchable website selection, date, task, category, notes, hours/minutes, editing, duplication, and deletion with confirmation. Inactive websites remain available for historical logging and reports.
- Monthly targets: default allocation plus overrides per website/month/year, including zero-hour targets. Restore a default by removing the override.
- Reports: daily, Monday–Sunday weekly, monthly, yearly, and custom date ranges; website and category filters; website, category, and day charts; tables and CSV/Excel exports. Reports intentionally include inactive websites unless filtered to a specific website.
- Settings: light/dark mode, primary-owner account details, full JSON data backup, and getting-started guide.
- User Management: primary-owner-only account creation, role/status management, password resets, and audit history.
- Responsive layouts, loading/error/empty states, keyboard focus, modal focus trapping, escape-to-close, and reduced-motion support.

The dashboard counts active websites whose project start date is on or before the selected month. Charts and recent dashboard work use that same portfolio. Dates are stored as validated `YYYY-MM-DD` strings, so calendar dates do not shift across timezones. All aggregation uses integer minutes; monthly allocations are converted to minutes. Actual logs must be between one minute and 24 hours per entry and cannot precede their website's start date. Remaining time can be negative. Completion percentages can exceed 100%; progress bars cap at 100%.

## Architecture

```text
src/                 React application, reusable UI, responsive CSS, API client
server/app.js        Express API factory, auth, CRUD, reports, exports
server/models.js     User, Website, WorkLog, MonthlyAllocation, and AuditLog schemas
server/email.js      SMTP transport and account/security email templates
server/validation.js Zod request validation
server/index.js      MongoDB connection and application bootstrap
shared/tracking.js   Integer-minute calculations, date helpers, report filters
scripts/             Environment setup and optional persistent local database
tests/               Calculation/validation tests and real MongoDB API integration
```

Passwords are bcrypt hashed. Sessions use signed JWTs in HttpOnly, SameSite Strict cookies with a database-backed version for immediate deactivation and reset invalidation. Mutations require a custom request header, cross-origin CORS access is disabled, auth and recovery attempts are rate limited, and every write route checks the caller's role. All roles share the same workspace data; only the primary Admin can manage users, change roles, and view audit history. Recovery codes are hashed, expire after 10 minutes, and are single-use. CSV exports escape spreadsheet formulas; Excel cells are stored as strings rather than formulas. Fonts load from Google Fonts with local sans-serif fallbacks.

API routes include `POST /api/auth/bootstrap` (one time), `/login`, `/logout`, `/change-password`, `/forgot-password`, `/reset-password`; `GET /api/auth/setup-status`, `/auth/me`; primary-owner `/api/users` and `/api/audit-logs`; shared `GET /api/data`; role-protected website, log, allocation and export routes. Public registration is disabled. Individual exports are `GET /api/websites/:id/export/csv|xlsx`; combined exports are `GET /api/export/all/csv|xlsx`. Filtered report export query parameters remain `websiteId`, `category`, `from`, and `to`.

## Verification

```powershell
npm.cmd test
npm.cmd run build
```

Optional Chrome end-to-end checks: `npm.cmd run test:browser` after building. This uses installed Chrome/Edge on Windows (or `CHROME_PATH`), an isolated database, and writes desktop, dark, and mobile screenshots to `.data/screenshots`. Test data is removed afterwards.

Tests cover bootstrap, Admin/Editor/Viewer API permissions, shared workspace access, temporary passwords, account deactivation, password recovery and reuse/expiry, audit access, month/year calculations, CSV escaping, CRUD, historical individual/combined Excel and CSV exports, backups, and cascading website deletion.

Integration tests launch an isolated temporary MongoDB and do not connect to your configured application database. They need a MongoDB binary download on first run (cached in `.data/mongodb-binaries`). Run calculation tests without MongoDB via `node --test tests/tracking.test.js`.

JSON backup is an export for safekeeping and external processing; this version does not include in-app restore. Use `mongodump`/`mongorestore` or Atlas snapshots for operational database recovery. Email address verification and background timers are not included.
