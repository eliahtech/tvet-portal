import pg from "pg";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
export async function openDb({
  url = process.env.DATABASE_URL,
  directory = process.env.DATA_DIR || "./data",
} = {}) {
  let local,
    pool,
    tail = Promise.resolve();
  if (url)
    pool = new pg.Pool({
      connectionString: url,
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : process.env.DATABASE_SSL === "no-verify"
            ? { rejectUnauthorized: false }
            : {
              rejectUnauthorized: true,
              ...(process.env.PG_CA_CERT ? { ca: process.env.PG_CA_CERT } : {}),
            },
      max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
    });
  else {
    if (directory !== ":memory:") await mkdir(directory, { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    local = new PGlite(
      directory === ":memory:" ? undefined : path.join(directory, "postgres"),
    );
  }
  const raw = async (sql, params = []) =>
    pool ? pool.query(sql, params) : local.query(sql, params);
  const serial = (fn) => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
  const query = (sql, params = []) =>
    local ? serial(() => raw(sql, params)) : raw(sql, params);
  const tx = (fn) =>
    local
      ? serial(() =>
          local.transaction((t) => fn({ query: (s, p = []) => t.query(s, p) })),
        )
      : (async () => {
          const c = await pool.connect();
          try {
            await c.query("BEGIN");
            const r = await fn(c);
            await c.query("COMMIT");
            return r;
          } catch (e) {
            await c.query("ROLLBACK");
            throw e;
          } finally {
            c.release();
          }
        })();
  return {
    query,
    tx,
    local: !!local,
    close: () => (pool ? pool.end() : local.close()),
  };
}
export async function migrate(db) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort()) {
    if (
      (
        await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
          file,
        ])
      ).rows.length
    )
      continue;
    const sql = await readFile(
      new URL("../db/" + file, import.meta.url),
      "utf8",
    );
    await db.tx(async (t) => {
      for (const statement of sql
        .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
        .map((s) => s.trim())
        .filter(Boolean))
        await t.query(statement);
      await t.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
    });
  }
  // Browser roles receive no policies. All access goes through the authorized backend.
  const ownedTables = [
    "schema_migrations",
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
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
      [ownedTables],
    )
  ).rows;
  const roles = (
    await db.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
    )
  ).rows;
  for (const { tablename } of tables) {
    const table = '"' + tablename.replaceAll('"', '""') + '"';
    await db.query("ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY");
    for (const { rolname } of roles)
      await db.query("REVOKE ALL ON TABLE " + table + " FROM " + rolname);
  }
}
