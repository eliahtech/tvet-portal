import "dotenv/config";
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function copyBackup(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (destination === source || destination.startsWith(source + path.sep))
    throw Error("Choose a backup destination outside the data directory");
  try {
    await stat(destination);
    throw Error("Destination already exists. Choose a new empty path.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    const p = JSON.parse(
      await readFile(path.join(source, "server.pid"), "utf8"),
    );
    try {
      process.kill(p.pid, 0);
      throw Error(
        "Stop the local portal server before backing up or restoring data",
      );
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await stat(path.join(source, "postgres"));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(
    path.join(destination, "backup-manifest.json"),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        format: "tvet-local-directory-v1",
        note: "Stopped PGlite database plus private documents. Keep this directory private.",
      },
      null,
      2,
    ),
  );
  return destination;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env.DATABASE_URL)
    throw Error(
      "This helper is for stopped local development data only. Use PostgreSQL and Storage backup procedures in docs/OPERATIONS.md for production.",
    );
  const [operation, destination] = process.argv.slice(2);
  if (!["backup", "restore"].includes(operation) || !destination)
    throw Error(
      "Usage: node scripts/local-backup.js backup DESTINATION or restore BACKUP_DIRECTORY NEW_DATA_DIRECTORY",
    );
  const result =
    operation === "backup"
      ? await copyBackup(process.env.DATA_DIR || "./data", destination)
      : await copyBackup(destination, process.argv[4] || "./restored-data");
  console.log("Local data copied to " + result);
}
