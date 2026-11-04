import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { openDb, migrate } from "../src/db.js";
import { id, one, audit } from "../src/util.js";
export function parseCsv(text) {
  const result = [],
    row = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (ch === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      if (row.some((x) => x.trim())) result.push([...row]);
      row.length = 0;
      field = "";
    } else field += ch;
  }
  if (quoted) throw Error("Unclosed quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((x) => x.trim())) result.push(row);
  return result;
}
export async function importCatalogue(db, text) {
  const [header, ...data] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (
    !header ||
    !["course", "unit", "unit_code"].every((c) => header.includes(c))
  )
    throw Error("CSV requires course, unit and unit_code columns");
  if (data.length > 5000) throw Error("Import up to 5,000 rows per file");
  return db.tx(async (t) => {
    let count = 0;
    for (const row of data) {
      const r = Object.fromEntries(
        header.map((k, i) => [k, row[i]?.trim() || ""]),
      );
      if (r.course.length < 2 || r.course.length > 200)
        throw Error("Every row needs a valid course name");
      let c = await one(t, "SELECT id FROM courses WHERE name=$1", [r.course]);
      if (!c) {
        c = { id: id() };
        await t.query(
          "INSERT INTO courses(id,name,description) VALUES($1,$2,$3)",
          [c.id, r.course, (r.course_description || "").slice(0, 2000)],
        );
      }
      if (r.unit || r.unit_code) {
        if (!r.unit || !r.unit_code)
          throw Error("Unit name and code must both be supplied");
        await t.query(
          "INSERT INTO units(id,course_id,name,code) VALUES($1,$2,$3,$4) ON CONFLICT(course_id,code) DO UPDATE SET name=EXCLUDED.name",
          [id(), c.id, r.unit.slice(0, 200), r.unit_code.slice(0, 100)],
        );
      }
      count++;
    }
    await audit(t, null, "catalogue.imported", "", { rows: count });
    return count;
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw Error("Usage: npm run catalogue:import -- path/to/catalogue.csv");
  const db = await openDb();
  try {
    await migrate(db);
    const count = await importCatalogue(
      db,
      await readFile(process.argv[2], "utf8"),
    );
    console.log("Imported " + count + " catalogue rows.");
  } finally {
    await db.close();
  }
}
