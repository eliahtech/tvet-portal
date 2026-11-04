import { Router } from "express";
import { one, rows, fail, page } from "./util.js";
export const resourceSelect = `SELECT r.id,r.title,r.description,r.course_id,r.unit_id,r.series_id,r.level,r.body,r.type,r.price_minor,r.year,r.status,r.pages,r.file_size,r.demo,r.created_at,r.updated_at,(r.preview_key IS NOT NULL) AS has_preview,c.name AS course,u.name AS unit,u.code AS unit_code,s.name AS series,s.status AS series_status FROM resources r JOIN courses c ON c.id=r.course_id JOIN units u ON u.id=r.unit_id JOIN assessment_series s ON s.id=r.series_id`;
export function publicRoutes({ db, files }) {
  const router = Router();
  router.get("/catalogue", async (req, res) => {
    const p = page(req.query),
      params = [],
      where = [
        "r.status='published'",
        "s.status='open'",
        "r.file_key IS NOT NULL",
      ];
    const add = (condition, value) => {
      params.push(value);
      where.push(condition.replaceAll("?", String(params.length)));
    };
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 150);
      add(
        "(r.title ILIKE $? OR u.name ILIKE $? OR u.code ILIKE $?)",
        "%" + q + "%",
      );
    }
    const mapping = {
      course: "r.course_id",
      unit: "r.unit_id",
      level: "r.level",
      body: "r.body",
      type: "r.type",
      series: "r.series_id",
    };
    for (const [k, col] of Object.entries(mapping))
      if (req.query[k]) add(col + "=$?", String(req.query[k]).slice(0, 200));
    if (req.query.year && Number.isInteger(Number(req.query.year)))
      add("r.year=$?", Number(req.query.year));
    if (req.query.free === "true") where.push("r.price_minor=0");
    if (req.query.max_price && Number.isFinite(Number(req.query.max_price)))
      add("r.price_minor<=$?", Math.round(Number(req.query.max_price) * 100));
    const sort =
      {
        newest: "r.created_at DESC",
        price: "r.price_minor ASC",
        title: "r.title ASC",
      }[req.query.sort] || "r.created_at DESC";
    const count = await one(
      db,
      "SELECT count(*)::int AS total FROM resources r JOIN units u ON u.id=r.unit_id JOIN assessment_series s ON s.id=r.series_id WHERE " +
        where.join(" AND "),
      params,
    );
    const items = await rows(
      db,
      resourceSelect +
        " WHERE " +
        where.join(" AND ") +
        " ORDER BY " +
        sort +
        `,r.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, p.size, p.offset],
    );
    if (req.user) {
      const owned = await rows(
        db,
        "SELECT resource_id FROM entitlements WHERE user_id=$1 AND state='active'",
        [req.user.id],
      );
      for (const r of items)
        r.owned = owned.some((x) => x.resource_id === r.id);
    }
    res.json({
      items,
      ...count,
      page: p.page,
      pages: Math.ceil(count.total / p.size),
    });
  });
  router.get("/courses", async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT c.*,count(r.id)::int AS paper_count FROM courses c LEFT JOIN resources r ON r.course_id=c.id AND r.status='published' AND r.series_id IN (SELECT id FROM assessment_series WHERE status='open') GROUP BY c.id ORDER BY c.name",
      ),
    ),
  );
  router.get("/taxonomy", async (req, res) =>
    res.json({
      units: await rows(db, "SELECT * FROM units ORDER BY name"),
      series: await rows(
        db,
        "SELECT * FROM assessment_series ORDER BY year DESC,name",
      ),
      taxonomy: await rows(db, "SELECT * FROM taxonomy ORDER BY kind,name"),
    }),
  );
  router.get("/resources/:id", async (req, res) => {
    const r = await one(
      db,
      resourceSelect +
        " WHERE r.id=$1 AND r.status='published' AND s.status='open'",
      [req.params.id],
    );
    if (!r) fail(404, "Paper not found or no longer publicly available");
    r.owned = !!(
      req.user &&
      (await one(
        db,
        "SELECT 1 FROM entitlements WHERE user_id=$1 AND resource_id=$2 AND state='active'",
        [req.user.id, r.id],
      ))
    );
    res.json(r);
  });
  router.get("/resources/:id/preview", async (req, res) => {
    const r = await one(
      db,
      "SELECT r.preview_key FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.id=$1 AND r.status='published' AND s.status='open'",
      [req.params.id],
    );
    if (!r?.preview_key) fail(404, "Preview unavailable");
    res
      .type("pdf")
      .set("Cache-Control", "public,max-age=60")
      .send(await files.get(r.preview_key));
  });
  router.get("/bundles", async (req, res) => {
    const bundles = await rows(
      db,
      "SELECT b.* FROM bundles b WHERE b.active=true AND EXISTS(SELECT 1 FROM bundle_items WHERE bundle_id=b.id) AND NOT EXISTS(SELECT 1 FROM bundle_items bi JOIN resources r ON r.id=bi.resource_id JOIN assessment_series s ON s.id=r.series_id WHERE bi.bundle_id=b.id AND (r.status<>'published' OR s.status<>'open' OR r.file_key IS NULL))",
    );
    for (const b of bundles)
      b.items = await rows(
        db,
        "SELECT r.id,r.title FROM resources r JOIN bundle_items bi ON bi.resource_id=r.id WHERE bi.bundle_id=$1",
        [b.id],
      );
    res.json(bundles);
  });
  return router;
}
