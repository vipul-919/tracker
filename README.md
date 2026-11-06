# Tempo — Website Work Hours Tracker

A full-stack React, Express, and MongoDB application for managing website allocations and daily work. Each account owns its own websites, monthly targets, and logs.

## Quick start (Windows PowerShell)

Install Node.js **22.12 or newer**. In this directory:

```powershell
npm.cmd install
npm.cmd run setup
```

`setup` creates `.env` with a random session secret and preserves existing configuration. In PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running.

Choose a MongoDB connection:

- **Installed MongoDB Community:** start its local service, using the default connection below.
- **MongoDB Atlas:** set `MONGODB_URI` in `.env` to your connection string. Configure database credentials and network access in Atlas.
- **Convenient local development:** run `npm.cmd run db` in a separate terminal. This downloads and runs a real MongoDB binary; the first run needs internet access. Records persist under `.data/mongodb` across restarts. Leave that terminal open. Do not run this alongside another database on port 27017. This helper is for development; use a managed or installed MongoDB service in production.

Then run:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173** and select **Create an account**. There are no default passwords or fabricated records. Add websites, set monthly hours, and log your work. The Express API listens on port 3001; Vite proxies `/api` to it.

On other shells use `npm` instead of `npm.cmd`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API / production HTTP port (default 3001). |
| `MONGODB_URI` | MongoDB connection, default `mongodb://127.0.0.1:27017/work-hours-tracker`. |
| `JWT_SECRET` | Random secret of at least 32 characters. Generate with `npm run setup`. |
| `NODE_ENV` | `development` locally; `production` enables secure cookies and production security headers. |

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
5. Add server-side environment variables for Production (and Preview if needed): `MONGODB_URI` with the Atlas connection string, `JWT_SECRET` with a random secret of at least 32 characters, and `NODE_ENV=production`. Generate a separate secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Never prefix these secrets with `VITE_`.
6. Deploy. Open the HTTPS deployment URL, create an account, add a website, and save a work entry. Refresh to verify persistence. If environment variables change, redeploy.

Do not use `npm run db`, a localhost MongoDB URI, or `npm start` as Vercel build commands. Vercel runs the API function automatically. Your local records are separate from Atlas unless migrated. Preview deployments using the same Atlas URI share production data; use a separate database for previews if needed.

For a 503 API response, check Vercel Function logs for missing environment variables, Atlas credentials, or Atlas network-access restrictions. The built-in authentication rate limiter is per function instance; configure Vercel Firewall rate limits or a shared rate-limit store for deployment-wide limits. This repository contains the deployment configuration; an actual Vercel deployment still requires your Vercel account and Atlas setup.

## Features

- Dashboard: active websites, monthly allocation, actual and remaining time, completion percentage, website progress, cumulative work-versus-target chart, recent logs, over-target and under-target summaries.
- Website management: add, edit, search, filter, activate/deactivate, and delete with confirmation. Deleting a website also deletes its work logs and allocations.
- Calendar: custom accessible React calendar with 12-month annual view, detailed monthly view, year navigation, daily totals, today marker, and clickable dates. Open any date to see and edit entries or add multiple work logs.
- Work logs: searchable website selection, date, task, category, notes, hours/minutes, editing, duplication, and deletion with confirmation. Inactive websites remain available for historical logging and reports.
- Monthly targets: default allocation plus overrides per website/month/year, including zero-hour targets. Restore a default by removing the override.
- Reports: daily, Monday–Sunday weekly, monthly, yearly, and custom date ranges; website and category filters; website, category, and day charts; tables and CSV/Excel exports. Reports intentionally include inactive websites unless filtered to a specific website.
- Settings: light/dark mode, account details, full JSON data backup, and getting-started guide.
- Responsive layouts, loading/error/empty states, keyboard focus, modal focus trapping, escape-to-close, and reduced-motion support.

The dashboard counts active websites whose project start date is on or before the selected month. Charts and recent dashboard work use that same portfolio. Dates are stored as validated `YYYY-MM-DD` strings, so calendar dates do not shift across timezones. All aggregation uses integer minutes; monthly allocations are converted to minutes. Actual logs must be between one minute and 24 hours per entry and cannot precede their website's start date. Remaining time can be negative. Completion percentages can exceed 100%; progress bars cap at 100%.

## Architecture

```text
src/                 React application, reusable UI, responsive CSS, API client
server/app.js        Express API factory, auth, CRUD, reports, exports
server/models.js     User, Website, WorkLog, MonthlyAllocation schemas and indexes
server/validation.js Zod request validation
server/index.js      MongoDB connection and application bootstrap
shared/tracking.js   Integer-minute calculations, date helpers, report filters
scripts/             Environment setup and optional persistent local database
tests/               Calculation/validation tests and real MongoDB API integration
```

Passwords are bcrypt hashed. Sessions use signed JWTs in HttpOnly, SameSite Strict cookies with a seven-day lifetime. Mutations require a custom request header, cross-origin CORS access is disabled, auth attempts are rate limited, and queries are scoped to the authenticated user. CSV exports escape spreadsheet formulas; Excel cells are stored as strings rather than formulas. Fonts load from Google Fonts with local sans-serif fallbacks.

API routes: `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`; `GET /api/data`; `POST /api/websites`; `PUT/DELETE /api/websites/:id`; `POST /api/logs`; `PUT/DELETE /api/logs/:id`; `PUT /api/allocations`; `DELETE /api/allocations/:id`; `GET /api/export/csv`, `/xlsx`; `GET /api/backup`. Export query parameters: `websiteId`, `category`, `from`, `to`.

## Verification

```powershell
npm.cmd test
npm.cmd run build
```

Optional Chrome end-to-end checks: `npm.cmd run test:browser` after building. This uses installed Chrome/Edge on Windows (or `CHROME_PATH`), an isolated database, and writes desktop, dark, and mobile screenshots to `.data/screenshots`. Test data is removed afterwards.

Tests cover month and website isolation, inactive/future projects, overrides and zero allocations, overages, edits/deletions, yearly aggregation, date validation, invalid durations, CSV escaping, registration/login/logout, request protection, cross-account access, database CRUD, filtered CSV/Excel exports, backups, and cascading website deletion.

Integration tests launch an isolated temporary MongoDB and do not connect to your configured application database. They need a MongoDB binary download on first run (cached in `.data/mongodb-binaries`). Run calculation tests without MongoDB via `node --test tests/tracking.test.js`.

JSON backup is an export for safekeeping and external processing; this version does not include in-app restore. Use `mongodump`/`mongorestore` or Atlas snapshots for operational database recovery. Password reset, email verification, multi-user shared projects, and background timers are not included.
