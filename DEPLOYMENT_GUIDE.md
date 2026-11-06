# Deployment and initialization

## Observed state on 6 November 2026

Local `.env` uses localhost MongoDB and has a JWT secret meeting the minimum length. Owner-bootstrap token, APP_URL and SMTP settings are absent/empty. A read-only connection attempt timed out; the configured database was not verified. Local env values do not establish Vercel configuration. No production settings were inspected or changed, no live deployment was verified, and no application database records were changed by this handover.

## Local startup

1. Use Node 24.x. Install locked dependencies with `npm.cmd ci` if needed.
2. Run `npm.cmd run setup`. It preserves configured values, appends missing keys, and generates a local ADMIN_BOOTSTRAP_TOKEN. Inspect/edit `.env` privately; do not send its contents in chat.
3. Start an installed local MongoDB service, use the existing persistent development helper `npm.cmd run db`, or configure an authorized Atlas development database. The helper stores records in `.data/mongodb`; never delete this folder to fix connectivity.
4. Set SMTP variables and APP_URL as below. Run `npm.cmd run dev`, open http://127.0.0.1:5173, and choose Set up primary Admin if an owner does not exist. Enter the token privately and choose your own name, email and password.
5. Remove the local bootstrap token after successful setup and restart the API. Do not initialize a second owner or change an existing user's credentials without authorization.

For a local built version use `npm.cmd run build` and `npm.cmd start`, then http://127.0.0.1:3001. Keep NODE_ENV=development for local HTTP; production cookies require HTTPS.

## Vercel and Atlas

These steps require the owner's external account access. Obtain approval before changing production variables, redeploying, or migrating data.

| Setting | Required value/purpose |
| --- | --- |
| Node runtime | 24.x, matching package.json. |
| Framework/build/output | Vite / npm run build / dist. Repository root is the project root. |
| MONGODB_URI | Atlas Drivers connection string with the intended application database; never localhost. URL-encode credentials. |
| JWT_SECRET | Unique random secret of at least 32 characters; keep stable across deployments unless intentionally invalidating sessions. |
| NODE_ENV | production. |
| ADMIN_BOOTSTRAP_TOKEN | Long random one-time secret until the primary Admin exists. Remove after setup and redeploy. |
| APP_URL | Deployed HTTPS application URL used in invitation/reset emails. |
| SMTP_HOST / SMTP_PORT | Provider host and port, commonly 587 or 465. |
| SMTP_USER / SMTP_PASSWORD | Provider credentials or application password. |
| SMTP_FROM_EMAIL / SMTP_FROM_NAME | Authorized sender email and display name. |

Use a database-scoped Atlas user and configure network access for Vercel's outbound connections. Choose a separate preview database to prevent previews from sharing production records. Set variables in the correct Vercel environment scope. Never use a VITE_ prefix for secrets. Updating variables requires a new deployment; changing the local `.env` does not update Vercel.

`vercel.json` sends API paths to `api/index.js` and application paths to index.html. The API connects to Atlas and reuses its warm connection pool. Do not run the local database helper or npm start as a Vercel build command.

After deployment, visit `/api/auth/setup-status`: a successful JSON response verifies function startup and database availability at that moment. If needsOwner is true and bootstrapEnabled is true, initialize the owner through the UI. If an owner already exists, sign in or use recovery; do not reset the database. Remove ADMIN_BOOTSTRAP_TOKEN after initialization, redeploy, and check setup status again.

## SMTP and acceptance checks

SMTP delivery was tested only with an injected sender in isolated tests. Real sender authorization, DNS/TLS, provider quotas and inbox delivery still require verification with the configured provider.

- Create one Editor and Viewer through User Management and verify invitations arrive. Change their temporary passwords at first sign-in.
- Confirm Editor CRUD and Viewer read/export access. A direct Viewer POST/PUT/DELETE API request must return 403.
- Request a recovery code, confirm delivery, use it once, verify reuse fails, and verify expiry after 10 minutes. Confirm old sessions fail after reset.
- Download individual and combined CSV/Excel files, including inactive websites and historical logs.
- Check dashboard totals, zero monthly overrides, yearly report filters and mobile layout using representative authorized data.
- Test Admin account changes in Settings. Logout invalidates all sessions for that account.

## Diagnosing a 503

The Vercel adapter now returns a generic JSON 503 even when JWT_SECRET is missing. Function logs distinguish missing MONGODB_URI, invalid JWT_SECRET, and database connection failure without printing credentials. For connection failure, check Atlas credentials, database permissions, network rules and cluster availability. Redeploy after correcting env configuration. A local isolated test pass does not prove these production settings.

Rate-limit stores are per process/function instance. Configure deployment-wide protection with a shared store or hosting firewall before exposing the service broadly. Preserve backups through Atlas snapshots or database tools; the JSON export is workspace data only and has no restore workflow. Any restore or destructive migration requires separate approval.

## Upgrade an existing owner without recreating the account

After deploying the owner-access update, sign in with the existing account. If no owner is configured, an Enable owner access banner appears. Configure a long random ADMIN_BOOTSTRAP_TOKEN privately in Vercel (with production configuration approval) and redeploy if needed. Enter that token into the banner and choose Enable User Management. The API verifies the token, preserves the user ID/password and existing work, sets the owner/workspace fields, and refreshes the session. The menu then appears. Remove the token and redeploy after success. If another owner already exists, the API refuses the claim. Never paste the token or passwords into chat.

An operator with authorized database access can alternatively preview a specific existing account:

```powershell
node scripts/upgrade-owner.js --email owner@example.com
```

This uses the configured server-only MONGODB_URI, disables automatic index/collection creation, and defaults to a dry run. Review the selected account and counts before repeating with --apply. The explicit apply promotes only that existing account, invalidates previous sessions on first promotion, and stamps its owned legacy records with workspaceId. It does not change passwords, delete records, attach unrelated accounts, or transfer ownership from another owner. Keep the existing unique primary-owner index in place. For a partially completed stamping run the operation is idempotent. Sign in again after CLI promotion. Do not run an apply against production without authorization.

For existing collaborators created before workspaceId was introduced, do not infer membership from email or a role. Verify their ownership relationship before any explicit membership migration. New accounts created from User Management are associated automatically. Global email/username uniqueness is preserved for backward-compatible login.
