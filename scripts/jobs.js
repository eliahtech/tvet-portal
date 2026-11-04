import "dotenv/config";
import { openDb } from "../src/db.js";
import { Pesapal } from "../src/services/pesapal.js";
import { runJobs } from "../src/jobs.js";
if (!process.env.DATABASE_URL)
  throw Error(
    "Use the HTTP server local job runner in development. The separate worker requires DATABASE_URL.",
  );
const db = await openDb();
try {
  console.log(JSON.stringify(await runJobs(db, new Pesapal())));
} finally {
  await db.close();
}
