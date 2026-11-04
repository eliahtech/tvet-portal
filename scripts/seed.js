import "dotenv/config";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pathToFileURL } from "node:url";
import { openDb, migrate } from "../src/db.js";
import { storage, inspectPdf } from "../src/services/storage.js";
import { id, one } from "../src/util.js";
export async function seed(db, files) {
  if (await one(db, "SELECT id FROM courses LIMIT 1")) {
    console.log("Catalogue already contains data; seed skipped.");
    return;
  }
  const courses = [
    [
      "ict",
      "ICT & Computing",
      "pc-display",
      "Computer Programming",
      "ICT-CP-01",
    ],
    [
      "engineering",
      "Engineering",
      "gear-wide-connected",
      "Electrical Principles",
      "ENG-EP-01",
    ],
    [
      "business",
      "Business Studies",
      "briefcase",
      "Business Communication",
      "BUS-BC-01",
    ],
    ["hospitality", "Hospitality", "cup-hot", "Food Production", "HOS-FP-01"],
    ["agriculture", "Agriculture", "flower1", "Crop Production", "AGR-CR-01"],
    [
      "construction",
      "Building & Construction",
      "buildings",
      "Construction Materials",
      "CON-CM-01",
    ],
  ];
  await db.tx(async (t) => {
    for (const [cid, name, icon, unit, code] of courses) {
      await t.query(
        "INSERT INTO courses(id,name,description,icon) VALUES($1,$2,$3,$4)",
        [
          cid,
          name,
          "Representative demonstration course. Configure your actual curriculum in Administration.",
          icon,
        ],
      );
      await t.query(
        "INSERT INTO units(id,course_id,name,code) VALUES($1,$2,$3,$4)",
        [cid + "-unit", cid, unit, code],
      );
    }
    await t.query(
      "INSERT INTO assessment_series(id,name,year) VALUES('demo-series','November/December',2026)",
    );
    for (const [kind, names] of [
      ["level", ["Level 4", "Level 5", "Level 6"]],
      ["body", ["CDACC", "KNEC", "Institution"]],
      [
        "type",
        [
          "Past Paper",
          "Revision Paper",
          "Marking Scheme",
          "Study Notes",
          "Model Paper",
        ],
      ],
    ])
      for (const name of names)
        await t.query(
          "INSERT INTO taxonomy(id,kind,name) VALUES($1,$2,$3) ON CONFLICT(kind,name) DO NOTHING",
          [id(), kind, name],
        );
  });
  for (const [cid, name, icon, unit, code] of courses)
    for (let i = 0; i < 2; i++) {
      const pdf = await PDFDocument.create(),
        font = await pdf.embedFont(StandardFonts.Helvetica),
        bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      for (let page = 0; page < 3; page++) {
        const p = pdf.addPage([595, 842]);
        p.drawRectangle({
          x: 0,
          y: 760,
          width: 595,
          height: 82,
          color: rgb(0.06, 0.09, 0.16),
        });
        p.drawText("TVET STUDY HUB - DEMONSTRATION", {
          x: 36,
          y: 802,
          size: 16,
          font: bold,
          color: rgb(1, 1, 1),
        });
        p.drawText(unit, {
          x: 36,
          y: 778,
          size: 12,
          font,
          color: rgb(0.7, 0.9, 0.85),
        });
        const lines = [
          "DEMO RESOURCE - Not an official examination paper.",
          name + " / " + code + " / Page " + (page + 1),
          "This document is original sample content for testing the portal.",
          "Replace it with documents you are authorized to distribute.",
          "",
          "Practice prompts:",
          "1. Define the key principles used in this unit.",
          "2. Explain a practical application in your field of study.",
          "3. Compare two common methods and their limitations.",
          "4. Outline the steps you would use to solve a typical problem.",
          "",
          "Use this space to make your own revision notes.",
        ];
        lines.forEach((l, n) =>
          p.drawText(l, {
            x: 36,
            y: 715 - n * 28,
            size: 11,
            font: n === 0 ? bold : font,
            color: rgb(0.15, 0.2, 0.25),
          }),
        );
        p.drawText("DEMO | PERSONAL STUDY | GENERATED SAMPLE", {
          x: 36,
          y: 40,
          size: 9,
          font,
          color: rgb(0.4, 0.5, 0.5),
        });
      }
      const inspected = await inspectPdf(Buffer.from(await pdf.save())),
        file = await files.put(inspected.bytes),
        preview = await files.put(inspected.preview, "pdf", "previews"),
        rid = id();
      await db.tx(async (t) => {
        await t.query(
          "INSERT INTO resources(id,title,description,course_id,unit_id,series_id,level,body,type,price_minor,year,status,file_key,preview_key,file_size,pages,demo) VALUES($1,$2,$3,$4,$5,'demo-series',$6,'Institution',$7,$8,2026,'published',$9,$10,$11,$12,true)",
          [
            rid,
            unit + (i ? " — Revision Notes" : " — Practice Paper"),
            "Original demonstration document for portal testing. This is not an official assessment paper. Replace demo content before launch.",
            cid,
            cid + "-unit",
            i ? "Level 5" : "Level 6",
            i ? "Study Notes" : "Model Paper",
            i ? 0 : 5000,
            file,
            preview,
            inspected.bytes.length,
            inspected.pages,
          ],
        );
        await t.query(
          "INSERT INTO resource_versions(id,resource_id,file_key,file_size) VALUES($1,$2,$3,$4)",
          [id(), rid, file, inspected.bytes.length],
        );
      });
    }
  console.log(
    "Seeded 6 demonstration courses and 12 labelled sample PDFs. No user accounts were created.",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env.NODE_ENV === "production")
    throw Error("Demo seed is disabled in production");
  const db = await openDb();
  try {
    await migrate(db);
    await seed(db, storage());
  } finally {
    await db.close();
  }
}
