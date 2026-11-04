import "dotenv/config";
import { openDb } from "../src/db.js";
// Run once using the migration-owner connection; this prints no credentials.
const db = await openDb();
try {
  const exists = await db.query(
    "SELECT 1 FROM pg_roles WHERE rolname='tvet_app'",
  );
  if (!exists.rows.length) await db.query("CREATE ROLE tvet_app LOGIN");
  await db.query("GRANT USAGE ON SCHEMA public TO tvet_app");
  const names = [
    "users",
    "sessions",
    "password_resets",
    "courses",
    "units",
    "assessment_series",
    "taxonomy",
    "resources",
    "resource_versions",
    "bundles",
    "bundle_items",
    "wishlists",
    "cart_items",
    "orders",
    "order_items",
    "payment_attempts",
    "payment_events",
    "entitlements",
    "receipts",
    "paper_requests",
    "notifications",
    "notification_recipients",
    "support_tickets",
    "ticket_messages",
    "download_logs",
    "deletion_jobs",
    "deletion_resources",
    "deletion_recipients",
    "jobs",
    "audit_logs",
    "ai_conversations",
    "ai_messages",
    "ai_usage",
    "discussion_threads",
    "discussion_replies",
    "discussion_reports",
    "subscription_orders",
    "subscription_attempts",
    "subscription_periods",
    "subscription_events",
    "subscription_reminders",
    "settings",
  ];
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
    [names],
  );
  for (const { tablename } of tables.rows) {
    await db.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON "' + tablename + '" TO tvet_app',
    );
    await db.query('DROP POLICY IF EXISTS tvet_backend ON "' + tablename + '"');
    await db.query(
      'CREATE POLICY tvet_backend ON "' +
        tablename +
        '" TO tvet_app USING(true) WITH CHECK(true)',
    );
  }
  await db.query(
    "GRANT USAGE, SELECT ON SEQUENCE ai_messages_sequence_no_seq TO tvet_app",
  );
  await db.query("GRANT SELECT ON schema_migrations TO tvet_app");
  await db.query(
    "DROP POLICY IF EXISTS tvet_migration_read ON schema_migrations",
  );
  await db.query(
    "CREATE POLICY tvet_migration_read ON schema_migrations FOR SELECT TO tvet_app USING(true)",
  );
  console.log(
    "Runtime role tvet_app is ready. Set its password with the database administrator tool, then use its dedicated connection for the server and worker.",
  );
} finally {
  await db.close();
}
