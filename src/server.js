import "dotenv/config";
import { openDb, migrate } from "./db.js";
import { storage } from "./services/storage.js";
import { Pesapal } from "./services/pesapal.js";
import { createApp } from "./app.js";
import { runJobs } from "./jobs.js";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
if (process.env.NODE_ENV === "production") {
  for (const name of [
    "DATABASE_URL",
    "APP_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])
    if (!process.env[name]) throw Error(name + " is required in production");
  if (!process.env.APP_URL.startsWith("https://"))
    throw Error("Production APP_URL must use HTTPS");
}
const db = await openDb();
if (process.env.NODE_ENV === "production") {
  const versions = await db.query(
    "SELECT version FROM schema_migrations WHERE version=$1",
    ["004_admin_subscriptions.sql"],
  );
  if (!versions.rows.length)
    throw Error(
      "Run the current database migrations before starting production",
    );
} else await migrate(db);
const app = createApp({ db, files: storage(), provider: new Pesapal() });
const portIndex = process.argv.indexOf("--port"),
  port = Number(
    portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 3000,
  );
const pidFile = path.resolve(process.env.DATA_DIR || "./data", "server.pid");
if (db.local) await writeFile(pidFile, JSON.stringify({ pid: process.pid }));
const server = app.listen(port, "0.0.0.0", () =>
  console.log(
    "TVET portal listening on port " +
      port +
      (db.local ? " (local development database)" : ""),
  ),
);
let jobTimer,
  busy = false;
if (db.local)
  jobTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runJobs(db, new Pesapal());
    } catch {
      console.error("Local job runner failed; jobs remain stored for retry.");
    } finally {
      busy = false;
    }
  }, 30000);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(jobTimer);
    server.close(async () => {
      await db.close();
      if (db.local) await unlink(pidFile).catch(() => {});
      process.exit(0);
    });
  });
