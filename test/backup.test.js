import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb, migrate } from "../src/db.js";
import { copyBackup } from "../scripts/local-backup.js";
test("stopped local database and file backup restores into a new directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tvet-backup-"));
  try {
    const source = path.join(root, "original"),
      backup = path.join(root, "backup"),
      restore = path.join(root, "restored");
    let db = await openDb({ directory: source });
    await migrate(db);
    await db.query(
      "INSERT INTO courses(id,name) VALUES('restore-test','Restore test course')",
    );
    await db.close();
    await mkdir(path.join(source, "private"), { recursive: true });
    await writeFile(path.join(source, "private", "test.txt"), "private bytes");
    await copyBackup(source, backup);
    await copyBackup(backup, restore);
    db = await openDb({ directory: restore });
    assert.equal(
      (await db.query("SELECT name FROM courses WHERE id='restore-test'"))
        .rows[0].name,
      "Restore test course",
    );
    assert.equal(
      await readFile(path.join(restore, "private", "test.txt"), "utf8"),
      "private bytes",
    );
    await db.close();
    await assert.rejects(copyBackup(source, backup), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
