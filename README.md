# TVET Study Hub

A portable TVET papers and study-resource sales portal built with Node.js, Express, Bootstrap, vanilla JavaScript, PostgreSQL, private Supabase Storage and Pesapal API 3.0.

Version 1.2 adds owner-controlled admin subscription billing; see [docs/ADMIN-SUBSCRIPTIONS.md](docs/ADMIN-SUBSCRIPTIONS.md) for the merchant setup and upgrade steps.

Version 1.1 adds private Gemini/Groq AI chat, a moderated discussion centre, icon-based bottom navigation, and a persistent first-use app guide. See [docs/AI-COMMUNITY.md](docs/AI-COMMUNITY.md) for configuration and the upgrade steps.

The application includes the public catalogue, three-field registration, protected purchased papers, profiles, cart/bundles, payment status/history/receipts, paper requests, support conversations, notifications, role-based administration, series closure/deletion, reports and audit logs. Source, schema, demo-document generator and tests are included. Demo PDFs are original samples, not actual official assessment papers.

**Start here:** run locally, inspect the flows, then configure Supabase, Pesapal and SMTP before production. Live payments, a remote Supabase project and real email delivery have not been verified because account credentials were not supplied. This package does not contain live credentials or preconfigured staff passwords.

## 1. Local setup

Install Node.js 26 LTS (tested with Node 26.13.0). `package.json` pins `engines.node` to `26.x`, which is also the setting Vercel reads to choose its runtime. Extract the project and open a terminal in its root.

```bash
npm ci
```

Copy `.env.example` to `.env` (on Windows, `copy .env.example .env`; on Linux/macOS, `cp .env.example .env`). Keep `DATABASE_URL` and Supabase credentials blank for local development. Set `APP_URL=http://localhost:3000`.

```bash
npm run db:migrate
npm run db:seed
npm run admin:create
npm start
```

The seed command is optional and refuses production mode. It creates six representative demo courses and twelve clearly labelled sample PDFs. It creates no users. All course names, units, categories, prices and series remain configurable. This is not a complete official TVET curriculum dataset.

The admin command prompts for a super-admin name, email, international phone number and hidden password. Use at least twelve characters. Run setup commands while the local server is stopped: local PGlite files must not be opened by multiple processes.

Open `http://localhost:3000`. Staff sign in at `/staff/login`. Students create accounts at `/register`; no activation or verification is required. After registration they set a password from My Profile before checkout. Returning users sign in with email and password.

Local data is persisted in `data/postgres` and `data/private`, outside the public directory. Do not expose this directory over HTTP. Local mode is for development only. Production refuses to start without a PostgreSQL connection and private Supabase storage.

## 2. Supabase production setup

Use a dedicated database/project or a deliberately isolated application database. Obtain the PostgreSQL connection string from your Supabase project's connection settings. The backend connects using `pg`; browser code never receives the database URL or service-role key.

1. Put the migration-owner connection in `DATABASE_URL` in your private environment. Supply the database CA certificate in `PG_CA_CERT` when necessary; certificate validation remains enabled. `DATABASE_SSL=false` is only for a trusted local database.
2. Run `npm run db:migrate`. Migrations install tables, constraints and indexes, enable RLS, and revoke table access for `anon` and `authenticated` when those roles exist. There are no browser policies for these tables.
3. Create the first super admin with `npm run admin:create`.
4. For least-privilege runtime access, run `node scripts/production-role.js` as the migration owner. Set the new `tvet_app` role's password privately using the database administrator's tooling (for example psql's interactive `\password tvet_app`). Use that role's connection for the web server and job worker. The runtime role has only the required table operations, no schema ownership. If a managed pooler cannot use your custom role, use a supported direct/session connection or a supported equivalent restricted role, and verify access before deployment.
5. Create a **private** Storage bucket named `papers`. No anonymous read/upload/list policies. The backend uses a server-only service key. Originals, previews, avatars and branding occupy separate object prefixes in this bucket; only the backend exposes the appropriate public previews/branding.
6. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `STORAGE_BUCKET=papers` on the server. Avatars use the same private bucket's `avatars/` prefix.
7. Set `NODE_ENV=production` and a real HTTPS `APP_URL`. Production startup checks the migration table rather than applying owner-only schema changes. Future migrations must run using the migration owner, followed by the runtime-role setup helper to grant any new table access.

Never put `.env`, database passwords, SMTP credentials or Supabase service credentials into Git, the browser, or a public document. No Supabase Auth activation is used; the portal maintains its own hashed passwords and persistent sessions.

## 3. Pesapal configuration

Register your merchant account and use its sandbox credentials first. Set:

```text
PESAPAL_ENV=sandbox
PESAPAL_CONSUMER_KEY=<server-side key>
PESAPAL_CONSUMER_SECRET=<server-side secret>
APP_URL=https://your-real-domain.example
```

Register the IPN endpoint:

```bash
npm run pesapal:ipn
```

Save the returned identifier as `PESAPAL_IPN_ID` and restart the application. The endpoint is `POST /api/payments/ipn`; the browser return is `/payments/callback`. Both must be reachable by the provider over HTTPS.

Each checkout uses the **payment-attempt ID** as the merchant reference, and stores the provider tracking ID. IPNs/callbacks query GetTransactionStatus from the backend. Merchant reference, amount, currency and successful status must match before entitlement and receipt creation. Duplicate notifications are idempotent. Reversed payments revoke their entitlements.

An interrupted submission is deliberately not charged again automatically. Super admins can recover its tracking ID from the merchant dashboard using the attempt ID and link/reconcile it from Payments. A failed transaction reuses its existing hosted checkout rather than creating parallel charges. Use support/provider resolution when a checkout cannot be resumed. Refunds are a documented provider/manual process, not an automatic refund feature in this release.

Without credentials, checkout saves the order and clearly reports that payment is unavailable. It never simulates success. Orders with no provider submission may be cancelled by their owner. Orders with provider attempts must be reconciled before resolution. Duplicate/overlapping purchases are blocked.

Only after end-to-end sandbox verification should you set `PESAPAL_ENV=live` and replace the credentials/IPN identifier with the correct live configuration.

Official references: [API 3](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference), [submit order](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/submitorderrequest), [transaction status](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/gettransactionstatus), [register IPN](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/registeripnurl).

## 4. Email and background tasks

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Recovery links go only to the existing account email, expire after thirty minutes, are single-use and revoke old sessions. Signup does not require verification. Recovery requests return a generic response and do not expose tokens. Recovery emails are persisted in the job outbox and retried on delivery failure.

In local mode, the running server processes persisted jobs every thirty seconds. A separate local PGlite worker is not supported. In production, run `npm run jobs` from a real scheduler every minute with the same server environment. Example cron when `.env` is securely stored at the project root:

```cron
* * * * * cd /opt/tvet-portal && /usr/bin/node scripts/jobs.js >> /var/log/tvet-jobs.log 2>&1
```

For Docker, schedule `docker compose exec -T web node scripts/jobs.js` instead. Use appropriate log rotation. Jobs use row locking, leases and retries; payment reconciliation does not depend on a browser being open. Deletion requires a final admin confirmation and is not automatically executed by cron. In-app notices are stored immediately inside transactions; announcement email/SMS delivery is not enabled by this release.

## 5. Administration workflow

1. Super admin creates staff under Administrators, selecting only needed permissions.
2. Configure platform name, logo, favicon, contacts, policies and the deletion notice period under Settings. The initial seven-day minimum is a configurable default; confirm your actual policy before sales.
3. Maintain courses, units, levels, examining bodies and resource types under Courses & Units. Create assessment series.
4. Upload PDFs as drafts, check the categories, previews and prices, then publish. Only PDFs are supported for learning resources in this release. PNG/JPEG profile photos and PNG branding have separate validation.
5. Upload up to twenty PDFs per batch, each within `MAX_UPLOAD_MB` (default 20). A reverse proxy may impose a lower aggregate limit; the supplied Nginx example allows 60 MB per request. Split larger batches. PDF processing rejects encrypted/invalid documents, files above 500 pages and unusually large pages. Previews are rasterized/cropped before PDF embedding so hidden original page text is excluded. PDFs are rebuilt from page content to discard interactive annotations/actions.
6. Replace incorrect files without changing the paper ID; purchases remain valid and prior original files are retained until series deletion.
7. Review payments, requests and support tickets. Send targeted notifications from the notification screen. Admins can correct/suspend/reactivate students, record reasons and revoke sessions. They cannot promote themselves or change staff roles.
8. Close a series to stop public sales while preserving purchases. Reopen if needed.
9. For permanent deletion, review affected papers/buyers/unresolved orders, provide a reason/date and type the exact series name. Buyer notices are sent. Unresolved orders block scheduling. Buyers see the warning in their inbox and My Papers.
10. On or after the deadline, explicitly confirm deletion. Failed file-removal operations remain visible as running jobs and can be retried. Cancelling a scheduled deletion preserves files and notifies buyers. Completed deletion ends online access but retains order/receipt/history records.

Super-admin anonymization removes identifying profile fields and disables an account, preserving transaction links, support/audit records and historical operational messages. It is not a claim of complete personal-data erasure across every record or backup. Establish your retention policy before launch.

## 6. Import courses and units

For a larger verified curriculum, edit `docs/catalogue-template.csv` and run while local development is stopped (or with a production migration-owner connection):

```bash
npm run catalogue:import -- docs/catalogue-template.csv
```

The importer accepts up to 5,000 rows, creates missing courses, and inserts/renames units by code within a course. It is transactional and supports quoted CSV fields. Template rows are placeholders; replace them before importing. Online course/unit administration remains available.

## 7. Deployment and operations

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for server deployment, backup, recovery, runtime permissions and launch verification. Docker, Compose, systemd and Nginx examples are provided. This is a persistent Node/Express application; the supplied package is not a Cloudflare Worker or static-site deployment.

## 8. Verification

```bash
npm run check
npm test
npm audit --omit=dev
```

Tests use an actual embedded PostgreSQL engine with isolated data, Supertest for HTTP integration, synthetic provider replies for payment edge cases, a DOM harness for all screen routes, PDF content inspection, and a stopped-data backup/restore test. They do not contact live providers or use production data.

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for requirement mapping, completion details and known limits. The original approved specification is included in `docs/MASTER-PROMPT.md`.
