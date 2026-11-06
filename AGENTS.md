# Development instructions

This is the existing Tempo Website Work Hours Tracker. Preserve its React/Vite, Express, MongoDB, and ExcelJS stack, visual design, features, and shared-workspace semantics. Scope all data and user queries to the authenticated workspace. Never infer ownership from a login or a client-supplied email.

- Read PROJECT_STATUS.md and PROJECT_ARCHITECTURE.md before changes. Inspect Git status and preserve all existing work. Use a separate branch for substantial changes; do not commit without a request.
- Never display or commit `.env` values, connection strings, passwords, session cookies, bootstrap tokens, or SMTP credentials. `.env.example` contains placeholders only.
- Never delete application database records, reset a database, run destructive migrations, or change production configuration without explicit authorization. Existing automated tests use throwaway MongoDB instances and may perform CRUD there.
- Use integer minutes for calculations and validated YYYY-MM-DD strings for work dates. Preserve monthly zero overrides and historical/inactive website exports.
- Only the original workspace owner (isPrimaryAdmin, stored internally with role admin) manages users, roles, audit logs, backups, and settings. New users may be Editor or Viewer only. Editors manage workspace data. Viewers read and export only. Enforce permissions in APIs and UI. The primary Admin is protected against deletion, deactivation, downgrade, and edits by another Admin.
- Authentication uses HttpOnly cookies, versioned sessions, bcrypt hashes, forced first-login password change, and single-use expiring recovery codes. Preserve invalidation when passwords or account status change. Logout currently invalidates all sessions for the account.
- Reuse `createApp` for local and Vercel entry points. Never put secrets in VITE_ variables. Do not use a localhost MongoDB URI on Vercel.
- Run `npm.cmd test`, `npm.cmd run build`, and relevant `npm.cmd run test:browser` checks. Use npm on other shells. Browser checks need installed Chrome/Edge and a built dist directory. MongoDB binaries are cached under ignored `.data`.
- No lint configuration currently exists. Do not report lint as passing; Node syntax checks and a Vite build are separate checks.
- This Windows installation has Git at `C:/Program Files/Git/cmd/git.exe`; it may not be on PATH. Vite/esbuild may need sandbox escalation to read parent directories. An environment access failure is not evidence of an application defect.
- Do not infer production readiness from isolated tests. Atlas connection, SMTP delivery, owner setup, and Vercel deployment must be verified separately. Keep status and deployment documentation consistent with observed evidence.
