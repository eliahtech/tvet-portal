# Deployment, backup and recovery

## Production configuration

Use a persistent Node server with HTTPS, a private Supabase bucket and PostgreSQL. A small server should have sufficient memory for PDF parsing/rasterization; start with 2 GB available RAM for the application and adjust based on your actual documents/concurrency. Rendering runs in the application process, so keep administrative batches modest. This is a capacity starting point, not a measured load guarantee.

1. Install Node 26, extract the source, run `npm ci`, and keep application files owned by a deployment user.
2. Set the environment from `.env.example`; keep its permissions restricted. Use an actual HTTPS `APP_URL`. Configure PostgreSQL TLS with its trusted certificate chain, private Storage, Pesapal sandbox and SMTP.
3. Run migrations, first-admin setup and runtime-role setup under the migration-owner connection as described in the README. Replace the runtime connection with the restricted role.
4. Set `NODE_ENV=production`, `PORT=3000`, and `TRUST_PROXY=1` only when exactly one trusted reverse proxy is in front of Express. Prevent direct public access to the backend port. If your topology differs, set the actual count; do not blindly trust all forwarded addresses.
5. Configure a process manager. The included systemd unit assumes `/usr/bin/node`, `/opt/tvet-portal` and `/etc/tvet-portal.env`; adjust to your server. It runs as an unprivileged `tvet` user. No persistent local write access is needed in production.
6. Put Nginx or your platform's proxy in front of the server. The supplied Nginx configuration is a starting HTTP proxy example, not a finished TLS configuration. Install a valid certificate and redirect HTTP to HTTPS before sales. Do not bypass TLS validation.
7. Schedule the job runner every minute. Confirm it receives the same configuration as the web process. Keep application/job logs with rotation and suitable access restrictions.
8. Check `/health` (application liveness) and `/ready` (database query). Neither exposes credentials or database details. Configure monitoring and error alerts with your host.

### Docker alternative

After the remote database/schema is ready, supply the private `.env` and run:

```bash
docker compose build
docker compose up -d
```

The included Compose file binds the service only on `127.0.0.1:3000` for an HTTPS reverse proxy. Schedule `docker compose exec -T web node scripts/jobs.js` every minute. There is no database/storage volume in the production Compose file: those services are remote. Bootstrap/migrations require the owner connection and should run as a separate administrative task; do not put owner credentials into the long-running web container.

## Backups

Database records and document bytes are separate assets. A database backup alone does not preserve the PDFs.

### Local development (implemented and restore-tested)

Stop the server first. The helper refuses to copy data while its recorded server process is alive. It creates a new destination and never overwrites an existing backup directory.

```bash
node scripts/local-backup.js backup ../tvet-backup-2026-11-01
node scripts/local-backup.js restore ../tvet-backup-2026-11-01 ../tvet-restored-data
```

Set `DATA_DIR` to the restored directory to run against it. Keep `DATABASE_URL` blank for local mode. The test suite creates a real persisted local database, backs up its directory and private-file directory, restores to a separate location, then queries the restored row and compares restored bytes.

### Production database

Use your provider's supported database backup/PITR feature or PostgreSQL tools with a secured migration/backup connection. Do not assume any particular provider plan includes a backup feature. For a logical application-only backup, use `pg_dump` with `--format=custom` and explicitly select the portal tables listed in `scripts/production-role.js`, plus `schema_migrations`. Store the archive encrypted and access-restricted outside the application host. Supply connection secrets through a private environment or PostgreSQL credential file, not command arguments committed to source.

Example structure (replace the placeholder with the explicit portal table flags and run it with the backup connection already configured):

```text
pg_dump --format=custom --no-owner --no-acl [portal --table flags] --file=portal-database.dump
```

Do not indiscriminately restore an entire managed Supabase database into another project: provider-owned schemas, roles and extensions need their documented workflow. Restore application data into a clean staged database/project. Restore or apply the schema/migrations and runtime role appropriately, and check referential integrity before using the new connection.

### Production private files

Use a secure operator process or the Supabase Storage API to list every object under `documents/`, `previews/`, `avatars/` and `branding/`, download them preserving their keys, and retain an object manifest with sizes/checksums. Include original versions referenced in `resource_versions`; do not back up only the current resource file. Store the objects encrypted and restricted alongside the database backup. Never turn the bucket public to obtain a backup.

Production backup/restore against a real Supabase project has **not** been executed in this environment. Rehearse the provider-specific process before launch, then repeat regularly. This package includes the tested local backup helper and the production operating procedure, not an already provisioned remote backup service.

### Restore verification

Use an isolated staging project and credentials:

1. Restore application database records and all private objects with their original keys.
2. Apply migrations/runtime permissions as needed and disable live mail/payment actions while checking.
3. Verify users, course/unit counts, orders, receipts and entitlements.
4. Sign in to a staged account and verify one purchased PDF and one limited preview; compare object checksums with the backup manifest.
5. Verify reversed/revoked/deleted resources remain inaccessible, and no anonymous table policies were introduced.
6. Record the restoration date, elapsed time and any missing assets. Switch production only after staged checks pass.

Backups may retain historical documents after an operational deletion. Your published deletion/retention policy must explain retention and eventual backup expiry. Normal product deletion does not retroactively erase downloaded buyer copies or copies inside older operator backups.

## Payment incident handling

- Start with the stored order, attempt ID and provider tracking ID; do not accept screenshots as payment confirmation.
- Use Reconcile for submitted payments. Amount/currency/reference mismatches keep access locked.
- For `submission_unknown`, locate the attempt ID in Pesapal merchant records. The super admin's Recover Tracking Reference action verifies the provider's merchant reference before linking and reconciling. Do not create another charge merely because the first request timed out.
- An order marked `needs_review` means money may have been confirmed but access could not safely be fulfilled. Resolve the file/access issue or arrange a documented provider/manual refund and support communication. There is no automatic refund or payment-status override button.
- Failed/reversed events and receipts remain in history. Reversals revoke access; earlier completed status is not downgraded by an out-of-order failed notification.

## Series removal

Close/unpublish to stop sales without deleting buyers' access. Permanent deletion has an independent notice period, affected-buyer snapshot, explicit series-name confirmation, and a final execution action after the deadline. Unresolved orders block scheduling/execution. Failed physical removals remain as `running` for operator retry; the application blocks file access during that removal. Archive/closure is reversible, permanent object deletion is not a built-in recycle bin.

## Operational limits

- Public catalogue results are paginated, twelve per page. Student libraries/history and staff operational lists have conservative server-side caps (typically 100–1,000 rows); full database history is retained. Extend these lists with cursor pagination for larger deployments. CSV export currently caps at 10,000 orders.
- Only PDF learning-resource uploads are supported. Profile photos support PNG/JPEG; branding supports PNG. The default logo is an included SVG.
- PDF annotation/form interactivity is intentionally flattened away. Verify complex/scanned sample documents before public sales. A cropped raster preview protects hidden text but does not prevent someone copying legitimately downloaded originals.
- In-app announcements are immediate; outbound email is currently used for password recovery. SMS/WhatsApp notification delivery is not integrated.
- Rate limits use process memory. Use a shared limiter store or edge limits before horizontally scaling multiple web replicas. Sessions, jobs and entitlements already use the database.
- Browser HTML is rendered by client-side JavaScript, with server-generated titles/descriptions/canonical metadata. Dedicated full server rendering can be added if crawler requirements demand it.
- No live deployment, commercial load test or production provider connection was performed for this delivery.

## Launch verification

Confirm your branding, support details, actual course/unit data and published policies; remove demo content from the live catalogue. Test the complete registration/password/purchase/download flow in Pesapal sandbox, duplicate/delayed IPNs, mail recovery, staff permissions, closure notices and a staged deletion. Verify TLS, cron, database permissions, private buckets, backups and support handling on your chosen host before accepting real payments.
