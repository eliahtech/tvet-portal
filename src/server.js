import "dotenv/config";
import { Pesapal } from "./services/pesapal.js";
import { runJobs } from "./jobs.js";
import { boot } from "./bootstrap.js";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
const { db, app } = await boot();
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
