# Tempo: collaborative workspaces

Track website working hours with independent personal workspaces and team collaboration. The existing React/Vite + Express + MongoDB stack and UI are preserved.

## Start locally

Use Node 24.x. In PowerShell:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run db
```

Leave the optional persistent development database helper running, or use an installed MongoDB service / authorized development Atlas database instead. Configure `.env` privately, then in another terminal:

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:5173. Create an account to receive your personal workspace. Existing accounts receive their personal Owner membership on sign-in while retaining their original password and work records. No owner-bootstrap token is needed.

## Collaboration

- Choose the active workspace with the sidebar switcher. The last selection is remembered.
- In your own workspace, open **Workspace Members → Invite Member**, enter name/email and choose Editor or Viewer.
- The recipient signs in or registers with the invited email, then accepts or rejects the email link. Registering gives them their own personal workspace too.
- Invitations expire after seven days. Owners can resend, cancel, change roles, deactivate/reactivate or remove a membership. These actions never delete another person's account or change their other workspaces.
- Owners manage their workspace and members. Editors edit websites/logs/allocations. Viewers read and download all report formats. Roles are independent per workspace.
- SMTP is required to deliver invitation links and password recovery codes. A failed send is shown honestly and can be retried; no membership is granted before acceptance.

## Configuration

| Variable | Purpose |
| --- | --- |
| MONGODB_URI | Application database; use Atlas for Vercel, never localhost. |
| JWT_SECRET | Stable random server-only secret, minimum 32 characters. |
| APP_URL | Canonical application URL in invitation links, e.g. the deployed HTTPS URL. |
| NODE_ENV | development locally; production for HTTPS secure cookies. |
| PORT | Local API port, default 3001. |
| SMTP_HOST / SMTP_PORT | Provider host and port, commonly 587 or 465. |
| SMTP_USER / SMTP_PASSWORD | Provider credentials, never frontend variables. |
| SMTP_FROM_EMAIL / SMTP_FROM_NAME | Authorized sender email and display name. |

`ADMIN_BOOTSTRAP_TOKEN` is obsolete. Existing env values are preserved by setup; it no longer generates a bootstrap token. Never expose credentials or prefix them with VITE_.

## Verification and build

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

Tests use isolated temporary MongoDB, not your configured database. First use may download a binary, cached in ignored `.data`. Browser tests need installed Chrome/Edge or CHROME_PATH. They cover registration, existing/new invitations, reciprocal roles, workspace switching (including delayed responses), Viewer restrictions, CRUD, reports, exports, theme and mobile layout. No lint script is configured.

For a local built app, run `npm.cmd start` after building and open http://127.0.0.1:3001. Vercel serves dist plus the existing API function; do not use npm start or the local database helper as Vercel build commands.

See [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md), [PROJECT_STATUS.md](PROJECT_STATUS.md), [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), [CHANGELOG.md](CHANGELOG.md), and [AGENTS.md](AGENTS.md). Existing-data migration defaults to preview and provides backup-before-apply; do not reset your database to upgrade.




Test case 