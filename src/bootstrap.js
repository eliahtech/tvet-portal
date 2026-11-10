import { openDb, migrate } from "./db.js";
import { storage } from "./services/storage.js";
import { Pesapal } from "./services/pesapal.js";
import { createApp } from "./app.js";
export async function boot() {
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
  return { db, app };
}
