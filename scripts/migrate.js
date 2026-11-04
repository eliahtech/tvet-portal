import "dotenv/config";
import { openDb, migrate } from "../src/db.js";
const db = await openDb();
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.close();
}
