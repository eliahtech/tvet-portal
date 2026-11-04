import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, migrate } from "../src/db.js";
import { parseCsv, importCatalogue } from "../scripts/import-catalogue.js";
test("catalogue CSV import handles quoted names, updates units and rolls back invalid rows", async () => {
  const db = await openDb({ directory: ":memory:" });
  try {
    await migrate(db);
    assert.deepEqual(
      parseCsv(
        'course,unit,unit_code\n"Business, Finance","Costing ""A""",C-1\n',
      )[1],
      ["Business, Finance", 'Costing "A"', "C-1"],
    );
    assert.equal(
      await importCatalogue(
        db,
        "course,unit,unit_code\nICT,Programming,P-1\nICT,Networks,N-1\n",
      ),
      2,
    );
    await importCatalogue(
      db,
      "course,unit,unit_code\nICT,Programming Updated,P-1\n",
    );
    assert.equal(
      (await db.query("SELECT name FROM units WHERE code='P-1'")).rows[0].name,
      "Programming Updated",
    );
    await assert.rejects(
      importCatalogue(
        db,
        "course,unit,unit_code\nWill Roll Back,Valid,V-1\nInvalid Course,Missing Code,\n",
      ),
      /both be supplied/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM courses WHERE name='Will Roll Back'",
        )
      ).rows[0].n,
      0,
    );
    await db.query("CREATE TABLE unrelated_project(id text)");
    await migrate(db);
    assert.equal(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname='unrelated_project'",
        )
      ).rows[0].relrowsecurity,
      false,
    );
  } finally {
    await db.close();
  }
});
