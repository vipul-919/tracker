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

## Email setup and troubleshooting

Nodemailer is included. Configure these server-only values privately in `.env` (or in your deployment environment):

```dotenv
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-provider-smtp-password
SMTP_FROM_EMAIL=verified-sender@your-domain.example
SMTP_FROM_NAME=Tempo
APP_URL=https://your-tempo-domain.example
```

Use your provider's actual host and credentials, and an authorized sender. Port 587 requires STARTTLS; port 465 uses TLS immediately. If your provider requires an app password or SMTP-specific credential, use that credential. Never put secrets in VITE_ variables or source control. For local development APP_URL can be `http://127.0.0.1:5173`; remote recipients need a reachable deployed URL.

Run `npm.cmd run email:verify` to check configuration, connectivity, TLS and authentication without sending email. This does not establish sender authorization or inbox delivery. Restart the local server after changing `.env`; deployed environment changes require a new deployment. Then use **Resend invitation** on the failed row. Check provider delivery logs and spam folders if SMTP accepts mail but it does not arrive. Invitations remain pending until the recipient accepts.

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

## Brevo Transactional Email API (2026-11-13)

The existing invitation and password recovery flows now use Brevo when BREVO_API_KEY is set. Existing SMTP remains available when no Brevo key is configured; a Brevo failure never silently falls back to SMTP. No public general-purpose email endpoint was added. Existing authentication, workspace Owner invitation permissions and rate limits remain in place.

Configure BREVO_API_KEY, BREVO_FROM_EMAIL (an active verified Brevo sender), BREVO_FROM_NAME and EMAIL_TEST_TO privately in .env. Keep APP_URL set to the recipient-accessible application URL and configure MONGODB_URI and a real random JWT_SECRET. Never put credentials in frontend variables or tracked example files. Brevo credentials are not SMTP credentials.

Run `npm.cmd run email:verify` to check API authentication and active sender status without sending; run `npm.cmd run email:verify -- --send-test` to send one test email to EMAIL_TEST_TO. Start both servers with `npm.cmd run dev`, or separately use `npm.cmd run dev:server` and `npm.cmd run dev:client`. Use Workspace Members to invite or resend; recipients sign in and accept the invitation. Provider acceptance does not establish inbox delivery. Check Brevo transactional logs and recipient spam folders.

For deployment, set these values in the backend hosting environment and restart/redeploy after changes. Frontend requests remain same-origin through the Vite /api proxy locally and shared Express/Vercel entry points in production. No production settings or database records were changed.

Live verification: Brevo account authentication and active sender checks passed; one test email was accepted by Brevo. Recipient inbox receipt remains unconfirmed. Production Atlas and deployed invitation delivery remain unverified.

A placeholder-only Brevo configuration template is available in `.env.brevo.example`. The existing `.env.example` was already absent when this integration was implemented.
