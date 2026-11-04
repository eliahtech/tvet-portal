import { Router } from "express";
import {
  id,
  one,
  rows,
  fail,
  audit,
  publicUser,
  hashPassword,
  csvCell,
} from "./util.js";
import {
  allow,
  superOnly,
  text,
  password,
  identity,
  permissions,
  has,
} from "./auth.js";
import { resourceSelect } from "./routes-public.js";
import { inspectPdf } from "./services/storage.js";
import { notify } from "./services/notifications.js";
import { reconcile } from "./services/orders.js";
import {
  impact,
  scheduleDeletion,
  cancelDeletion,
  executeDeletion,
} from "./services/deletion.js";
const num = (v, min = 0, max = 100000000) => {
  if (v === null || v === "" || typeof v === "boolean")
    fail(400, "Enter a valid whole number");
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    fail(400, "Enter a valid whole number");
  return n;
};
export function adminRoutes({ db, files, provider, upload }) {
  const router = Router();
  router.use((req, res, next) => {
    if (!["admin", "super_admin"].includes(req.user?.role))
      fail(403, "Staff access required");
    if (req.user.role === "admin" && req.user.subscription_blocked)
      fail(
        402,
        "Your admin subscription has expired or requires payment. Open Subscription to renew.",
      );
    next();
  });
  router.get(
    "/notification-options",
    allow("notifications"),
    async (req, res) =>
      res.json({
        users: await rows(
          db,
          "SELECT id,name,email FROM users WHERE role='student' AND status<>'anonymized' ORDER BY name LIMIT 1000",
        ),
        resources: await rows(
          db,
          "SELECT id,title FROM resources ORDER BY title LIMIT 1000",
        ),
      }),
  );
  router.get("/request-resources", allow("support"), async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT r.id,r.title FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.status='published' AND s.status='open' ORDER BY r.title LIMIT 1000",
      ),
    ),
  );
  router.post(
    "/branding/:kind",
    superOnly,
    upload.single("file"),
    async (req, res) => {
      if (!["logo", "favicon"].includes(req.params.kind))
        fail(400, "Choose logo or favicon");
      const b = req.file?.buffer;
      if (
        !b ||
        b.length > 2 * 1024 * 1024 ||
        !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        fail(400, "Upload a PNG image smaller than 2 MB");
      const key = await files.put(b, "png", "branding"),
        setting = "branding_" + req.params.kind,
        old = await one(db, "SELECT value FROM settings WHERE key=$1", [
          setting,
        ]);
      await db.tx(async (t) => {
        await t.query(
          "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          [setting, JSON.stringify({ key })],
        );
        await audit(t, req.user.id, "branding.updated", req.params.kind);
      });
      if (old?.value?.key) await files.remove(old.value.key);
      res.json({ ok: true });
    },
  );
  router.get("/summary", async (req, res) => {
    const data = {};
    for (const [k, sql] of Object.entries({
      papers:
        "SELECT count(*)::int AS n FROM resources WHERE status='published'",
      users: "SELECT count(*)::int AS n FROM users WHERE role='student'",
      revenue:
        "SELECT coalesce(sum(amount_minor),0)::int AS n FROM orders WHERE status='completed'",
      pending:
        "SELECT count(*)::int AS n FROM orders WHERE status IN ('pending','needs_review')",
      requests:
        "SELECT count(*)::int AS n FROM paper_requests WHERE status='open'",
    })) {
      const required = {
        papers: "resources",
        users: "users",
        revenue: "payments",
        pending: "payments",
        requests: "support",
      }[k];
      data[k] =
        has(req.user, required) || (k === "revenue" && has(req.user, "reports"))
          ? (await one(db, sql)).n
          : null;
    }
    res.json(data);
  });
  router.get("/resources", allow("resources"), async (req, res) =>
    res.json(
      await rows(db, resourceSelect + " ORDER BY r.created_at DESC LIMIT 500"),
    ),
  );
  router.post(
    "/resources",
    allow("resources"),
    upload.array("files", 20),
    async (req, res) => {
      if (!req.files?.length) fail(400, "Select at least one PDF");
      const b = req.body;
      const unit = await one(
        db,
        "SELECT * FROM units WHERE id=$1 AND course_id=$2",
        [b.unit_id, b.course_id],
      );
      if (!unit) fail(400, "Select a unit belonging to the chosen course");
      const series = await one(
        db,
        "SELECT * FROM assessment_series WHERE id=$1 AND status='open'",
        [b.series_id],
      );
      if (!series) fail(400, "Select an open assessment series");
      const price = num(b.price_minor),
        year = num(b.year, 2000, 2100);
      const title = text(b.title, 3, 200),
        level = text(b.level),
        type = text(b.type),
        body = text(b.body || "Institution");
      for (const [kind, value] of [
        ["level", level],
        ["type", type],
        ["body", body],
      ])
        if (
          !(await one(db, "SELECT id FROM taxonomy WHERE kind=$1 AND name=$2", [
            kind,
            value,
          ]))
        )
          fail(400, "Select a configured " + kind);
      const results = [];
      for (const f of req.files) {
        let key, preview;
        try {
          if (!f.originalname.toLowerCase().endsWith(".pdf"))
            fail(400, "Only PDF files are accepted");
          const pdf = await inspectPdf(f.buffer);
          key = await files.put(pdf.bytes);
          preview = await files.put(pdf.preview, "pdf", "previews");
          const rid = id();
          await db.tx(async (t) => {
            const s = await one(
              t,
              "SELECT status FROM assessment_series WHERE id=$1 FOR UPDATE",
              [series.id],
            );
            if (s.status !== "open") fail(409, "Series is no longer open");
            await t.query(
              "INSERT INTO resources(id,title,description,course_id,unit_id,series_id,level,body,type,price_minor,year,status,file_key,preview_key,file_size,pages,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
              [
                rid,
                req.files.length === 1
                  ? title
                  : title + " — " + f.originalname.replace(/\.pdf$/i, ""),
                String(b.description || "").slice(0, 4000),
                b.course_id,
                b.unit_id,
                b.series_id,
                level,
                body,
                type,
                price,
                year,
                b.status === "published" ? "published" : "draft",
                key,
                preview,
                pdf.bytes.length,
                pdf.pages,
                req.user.id,
              ],
            );
            await t.query(
              "INSERT INTO resource_versions(id,resource_id,file_key,file_size,created_by) VALUES($1,$2,$3,$4,$5)",
              [id(), rid, key, pdf.bytes.length, req.user.id],
            );
            await audit(t, req.user.id, "resource.uploaded", rid);
          });
          results.push({ file: f.originalname, id: rid, success: true });
        } catch (e) {
          if (key) await files.remove(key).catch(() => {});
          if (preview) await files.remove(preview).catch(() => {});
          results.push({
            file: f.originalname,
            success: false,
            error: e.status ? e.message : "Unable to save this document",
          });
        }
      }
      res.json({ results });
    },
  );
  router.patch("/resources/:id", allow("resources"), async (req, res) => {
    await db.tx(async (t) => {
      const r = await one(t, "SELECT * FROM resources WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      if (!r || r.status === "deleted") fail(404, "Resource not found");
      const s = await one(
        t,
        "SELECT status FROM assessment_series WHERE id=$1 FOR UPDATE",
        [r.series_id],
      );
      if (s.status === "deleting")
        fail(409, "Cancel scheduled deletion before editing");
      const status = req.body.status || r.status;
      if (!["draft", "published", "archived"].includes(status))
        fail(400, "Invalid resource status");
      if (status === "published" && (!r.file_key || s.status !== "open"))
        fail(409, "Publishing requires a file and an open series");
      await t.query(
        "UPDATE resources SET title=$2,description=$3,price_minor=$4,status=$5,updated_at=now() WHERE id=$1",
        [
          r.id,
          text(req.body.title || r.title, 3, 200),
          String(req.body.description ?? r.description).slice(0, 4000),
          req.body.price_minor === undefined
            ? r.price_minor
            : num(req.body.price_minor),
          status,
        ],
      );
      await audit(t, req.user.id, "resource.updated", r.id, { status });
    });
    res.json({ ok: true });
  });
  router.post(
    "/resources/:id/replace",
    allow("resources"),
    upload.single("file"),
    async (req, res) => {
      if (!req.file) fail(400, "Select a PDF");
      const r = await one(db, "SELECT * FROM resources WHERE id=$1", [
        req.params.id,
      ]);
      if (!r || r.status === "deleted") fail(404, "Resource not found");
      const pdf = await inspectPdf(req.file.buffer),
        key = await files.put(pdf.bytes),
        preview = await files.put(pdf.preview, "pdf", "previews");
      try {
        await db.tx(async (t) => {
          const s = await one(
            t,
            "SELECT status FROM assessment_series WHERE id=$1 FOR UPDATE",
            [r.series_id],
          );
          if (["deleting", "deleted"].includes(s.status))
            fail(409, "This series cannot be edited during deletion");
          await t.query(
            "UPDATE resources SET file_key=$2,preview_key=$3,file_size=$4,pages=$5,updated_at=now() WHERE id=$1",
            [r.id, key, preview, pdf.bytes.length, pdf.pages],
          );
          await t.query(
            "INSERT INTO resource_versions(id,resource_id,file_key,file_size,created_by) VALUES($1,$2,$3,$4,$5)",
            [id(), r.id, key, pdf.bytes.length, req.user.id],
          );
          await audit(t, req.user.id, "resource.replaced", r.id);
        });
      } catch (e) {
        await files.remove(key);
        await files.remove(preview);
        throw e;
      }
      if (r.preview_key) await files.remove(r.preview_key);
      res.json({ ok: true });
    },
  );
  router.get("/catalogue", allow("catalogue"), async (req, res) =>
    res.json({
      courses: await rows(db, "SELECT * FROM courses ORDER BY name"),
      units: await rows(
        db,
        "SELECT u.*,c.name AS course FROM units u JOIN courses c ON c.id=u.course_id ORDER BY c.name,u.name",
      ),
      series: await rows(
        db,
        "SELECT * FROM assessment_series ORDER BY year DESC",
      ),
      taxonomy: await rows(db, "SELECT * FROM taxonomy ORDER BY kind,name"),
    }),
  );
  router.post("/catalogue/:kind", allow("catalogue"), async (req, res) => {
    const b = req.body,
      key = id();
    switch (req.params.kind) {
      case "course":
        await db.query(
          "INSERT INTO courses(id,name,description) VALUES($1,$2,$3)",
          [key, text(b.name), String(b.description || "").slice(0, 2000)],
        );
        break;
      case "unit":
        await db.query(
          "INSERT INTO units(id,course_id,name,code) VALUES($1,$2,$3,$4)",
          [key, text(b.course_id), text(b.name), text(b.code)],
        );
        break;
      case "series":
        await db.query(
          "INSERT INTO assessment_series(id,name,year) VALUES($1,$2,$3)",
          [key, text(b.name), num(b.year, 2000, 2100)],
        );
        break;
      case "taxonomy":
        if (!["level", "body", "type"].includes(b.kind))
          fail(400, "Invalid category");
        await db.query("INSERT INTO taxonomy(id,kind,name) VALUES($1,$2,$3)", [
          key,
          b.kind,
          text(b.name),
        ]);
        break;
      default:
        fail(404, "Category not found");
    }
    await audit(db, req.user.id, "catalogue.created", key, {
      kind: req.params.kind,
    });
    res.json({ id: key });
  });
  router.patch("/catalogue/:kind/:id", allow("catalogue"), async (req, res) => {
    const table = {
      course: "courses",
      unit: "units",
      series: "assessment_series",
      taxonomy: "taxonomy",
    }[req.params.kind];
    if (!table) fail(400, "Invalid category");
    await db.query("UPDATE " + table + " SET name=$2 WHERE id=$1", [
      req.params.id,
      text(req.body.name),
    ]);
    await audit(db, req.user.id, "catalogue.renamed", req.params.id);
    res.json({ ok: true });
  });
  router.post("/series/:id/close", allow("catalogue"), async (req, res) => {
    await db.tx(async (t) => {
      const s = await one(
        t,
        "SELECT * FROM assessment_series WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (s?.status !== "open") fail(409, "Only an open series can be closed");
      await t.query(
        "UPDATE assessment_series SET status='closed' WHERE id=$1",
        [s.id],
      );
      await audit(t, req.user.id, "series.closed", s.id);
    });
    res.json({ ok: true });
  });
  router.post("/series/:id/reopen", allow("catalogue"), async (req, res) => {
    const r = await db.query(
      "UPDATE assessment_series SET status='open' WHERE id=$1 AND status='closed' RETURNING id",
      [req.params.id],
    );
    if (!r.rows.length) fail(409, "Only a closed series can be reopened");
    await audit(db, req.user.id, "series.reopened", req.params.id);
    res.json({ ok: true });
  });
  router.get("/series/:id/impact", allow("deletion"), async (req, res) =>
    res.json(await impact(db, req.params.id)),
  );
  router.get("/deletions", allow("deletion"), async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT j.*,s.name,s.year FROM deletion_jobs j JOIN assessment_series s ON s.id=j.series_id ORDER BY j.created_at DESC LIMIT 100",
      ),
    ),
  );
  router.post("/series/:id/deletion", allow("deletion"), async (req, res) =>
    res.json(
      await scheduleDeletion(db, req.user.id, req.params.id, {
        ...req.body,
        reason: text(req.body.reason, 5, 1000),
      }),
    ),
  );
  router.post("/deletions/:id/cancel", allow("deletion"), async (req, res) => {
    await cancelDeletion(db, req.user.id, req.params.id);
    res.json({ ok: true });
  });
  router.post("/deletions/:id/execute", allow("deletion"), async (req, res) => {
    await executeDeletion(
      db,
      files,
      req.user.id,
      req.params.id,
      req.body.confirmation,
    );
    res.json({ ok: true });
  });
  router.get("/users", allow("users"), async (req, res) => {
    let list = await rows(
      db,
      "SELECT * FROM users WHERE role='student' ORDER BY created_at DESC LIMIT 1000",
    );
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((u) =>
        [u.name, u.email, u.phone, u.level, u.course_id, u.status].some((v) =>
          String(v).toLowerCase().includes(q),
        ),
      );
    }
    res.json(list.map(publicUser));
  });
  router.get("/users/:id", allow("users"), async (req, res) => {
    const u = await one(
      db,
      "SELECT * FROM users WHERE id=$1 AND role='student'",
      [req.params.id],
    );
    if (!u) fail(404, "User not found");
    res.json({
      user: publicUser(u),
      orders: await rows(
        db,
        "SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC",
        [u.id],
      ),
      papers: await rows(
        db,
        "SELECT e.*,r.title FROM entitlements e JOIN resources r ON r.id=e.resource_id WHERE e.user_id=$1",
        [u.id],
      ),
    });
  });
  router.patch("/users/:id", allow("users"), async (req, res) => {
    await db.tx(async (t) => {
      const u = await one(
        t,
        "SELECT * FROM users WHERE id=$1 AND role='student' FOR UPDATE",
        [req.params.id],
      );
      if (!u) fail(404, "Student not found");
      const reason = text(req.body.reason, 3, 1000);
      const p = identity({ ...u, ...req.body });
      const status = req.body.status || u.status;
      if (!["active", "suspended"].includes(status))
        fail(400, "Invalid account status");
      await t.query(
        "UPDATE users SET name=$2,email=$3,phone=$4,status=$5,status_reason=$6 WHERE id=$1",
        [u.id, p.name, p.email, p.phone, status, reason],
      );
      await t.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await notify(t, {
        users: [u.id],
        title: "Account updated",
        message: "An administrator updated your account. Reason: " + reason,
        actor: req.user.id,
      });
      await audit(t, req.user.id, "user.updated", u.id, { status, reason });
    });
    res.json({ ok: true });
  });
  router.get("/payments", allow("payments"), async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT o.*,u.name,u.email,a.id AS attempt_id,a.tracking_id,a.state AS attempt_state,a.failure FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_attempts a ON a.order_id=o.id ORDER BY o.created_at DESC LIMIT 500",
      ),
    ),
  );
  router.post(
    "/payments/:id/reconcile",
    allow("payments"),
    async (req, res) => {
      const a = await one(db, "SELECT * FROM payment_attempts WHERE id=$1", [
        req.params.id,
      ]);
      if (!a?.tracking_id) fail(409, "No submitted payment reference");
      const state = await reconcile(db, provider, a.tracking_id);
      await audit(db, req.user.id, "payment.reconciled", a.order_id);
      res.json({ status: state });
    },
  );
  router.post("/payments/:id/link", superOnly, async (req, res) => {
    const tracking = text(req.body.tracking_id);
    const a = await one(db, "SELECT * FROM payment_attempts WHERE id=$1", [
      req.params.id,
    ]);
    if (!a || a.tracking_id)
      fail(409, "Only unresolved submissions can be linked");
    const verified = await provider.status(tracking);
    if (verified.merchant_reference !== a.id)
      fail(409, "Provider merchant reference does not match");
    await db.query("UPDATE payment_attempts SET tracking_id=$2 WHERE id=$1", [
      a.id,
      tracking,
    ]);
    const state = await reconcile(db, provider, tracking);
    await audit(db, req.user.id, "payment.reference.recovered", a.id);
    res.json({ status: state });
  });
  router.get("/requests", allow("support"), async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT p.*,u.name,u.email FROM paper_requests p JOIN users u ON u.id=p.user_id ORDER BY created_at DESC LIMIT 500",
      ),
    ),
  );
  router.post("/requests/:id", allow("support"), async (req, res) => {
    const r = await one(db, "SELECT * FROM paper_requests WHERE id=$1", [
      req.params.id,
    ]);
    if (!r) fail(404, "Request not found");
    const status = req.body.status;
    if (!["open", "reviewing", "fulfilled", "unavailable"].includes(status))
      fail(400, "Invalid request status");
    const resource = req.body.resource_id || null;
    if (
      status === "fulfilled" &&
      !(await one(
        db,
        "SELECT r.id FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.id=$1 AND r.status='published' AND s.status='open'",
        [resource],
      ))
    )
      fail(400, "Select a published paper in an open series");
    await db.tx(async (t) => {
      await t.query(
        "UPDATE paper_requests SET status=$2,resource_id=$3 WHERE id=$1",
        [r.id, status, resource],
      );
      await notify(t, {
        users: [r.user_id],
        title: "Paper request updated",
        message: "Your request for " + r.unit + " is " + status + ".",
        link: resource ? "/paper/" + resource : "/account/requests",
        actor: req.user.id,
      });
      await audit(t, req.user.id, "request.updated", r.id, { status });
    });
    res.json({ ok: true });
  });
  router.get("/tickets", allow("support"), async (req, res) => {
    const list = await rows(
      db,
      "SELECT t.*,u.name FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY created_at DESC LIMIT 200",
    );
    for (const t of list)
      t.messages = await rows(
        db,
        "SELECT m.*,u.name,u.role FROM ticket_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=$1 ORDER BY created_at",
        [t.id],
      );
    res.json(list);
  });
  router.post("/tickets/:id", allow("support"), async (req, res) => {
    const ticket = await one(db, "SELECT * FROM support_tickets WHERE id=$1", [
      req.params.id,
    ]);
    if (!ticket) fail(404, "Ticket not found");
    const status = req.body.status === "closed" ? "closed" : "open";
    await db.tx(async (t) => {
      await t.query(
        "INSERT INTO ticket_messages(id,ticket_id,user_id,message) VALUES($1,$2,$3,$4)",
        [id(), ticket.id, req.user.id, text(req.body.message, 1, 4000)],
      );
      await t.query("UPDATE support_tickets SET status=$2 WHERE id=$1", [
        ticket.id,
        status,
      ]);
      await notify(t, {
        users: [ticket.user_id],
        title: "Support replied",
        message: "There is a reply to your ticket: " + ticket.subject,
        link: "/account/support",
        actor: req.user.id,
      });
      await audit(t, req.user.id, "ticket.replied", ticket.id);
    });
    res.json({ ok: true });
  });
  router.post("/notifications", allow("notifications"), async (req, res) => {
    const b = req.body;
    let audience = [];
    switch (b.target) {
      case "all":
        audience = await rows(
          db,
          "SELECT id FROM users WHERE role='student' AND status<>'anonymized'",
        );
        break;
      case "course":
        audience = await rows(
          db,
          "SELECT id FROM users WHERE course_id=$1" +
            (b.level ? " AND level=$2" : ""),
          b.level ? [b.target_id, b.level] : [b.target_id],
        );
        break;
      case "resource":
        audience = await rows(
          db,
          "SELECT user_id AS id FROM entitlements WHERE resource_id=$1",
          [b.target_id],
        );
        break;
      case "series":
        audience = await rows(
          db,
          "SELECT DISTINCT e.user_id AS id FROM entitlements e JOIN resources r ON r.id=e.resource_id WHERE r.series_id=$1",
          [b.target_id],
        );
        break;
      case "users":
        if (!Array.isArray(b.user_ids) || b.user_ids.length > 1000)
          fail(400, "Choose users");
        audience = await rows(
          db,
          "SELECT id FROM users WHERE id=ANY($1::text[]) AND role='student'",
          [b.user_ids],
        );
        break;
      default:
        fail(400, "Select a notification audience");
    }
    if (!audience.length) fail(400, "No users match this audience");
    await db.tx(async (t) => {
      await notify(t, {
        users: audience.map((u) => u.id),
        title: text(b.title, 3, 200),
        message: text(b.message, 3, 10000),
        priority: b.priority === "urgent" ? "urgent" : "normal",
        actor: req.user.id,
      });
      await audit(t, req.user.id, "notification.sent", "", {
        recipients: audience.length,
      });
    });
    res.json({ recipients: audience.length });
  });
  router.get("/bundles", allow("resources"), async (req, res) => {
    const b = await rows(db, "SELECT * FROM bundles");
    for (const x of b)
      x.items = await rows(
        db,
        "SELECT resource_id FROM bundle_items WHERE bundle_id=$1",
        [x.id],
      );
    res.json(b);
  });
  router.post("/bundles", allow("resources"), async (req, res) => {
    const b = req.body;
    if (
      !Array.isArray(b.resource_ids) ||
      b.resource_ids.length < 2 ||
      b.resource_ids.length > 50
    )
      fail(400, "Select 2 to 50 papers");
    const ids = [...new Set(b.resource_ids)];
    await db.tx(async (t) => {
      const rs = await rows(
        t,
        "SELECT * FROM resources WHERE id=ANY($1::text[])",
        [ids],
      );
      if (rs.length !== ids.length) fail(400, "Some papers were not found");
      const price = num(b.price_minor);
      if (price > rs.reduce((s, r) => s + r.price_minor, 0))
        fail(400, "Bundle price cannot exceed the paper total");
      const bid = id();
      await t.query(
        "INSERT INTO bundles(id,title,description,price_minor) VALUES($1,$2,$3,$4)",
        [bid, text(b.title), String(b.description || "").slice(0, 2000), price],
      );
      for (const r of ids)
        await t.query(
          "INSERT INTO bundle_items(bundle_id,resource_id) VALUES($1,$2)",
          [bid, r],
        );
      await audit(t, req.user.id, "bundle.created", bid);
    });
    res.json({ ok: true });
  });
  router.patch("/bundles/:id", allow("resources"), async (req, res) => {
    await db.query("UPDATE bundles SET active=$2 WHERE id=$1", [
      req.params.id,
      req.body.active === true,
    ]);
    await audit(db, req.user.id, "bundle.updated", req.params.id);
    res.json({ ok: true });
  });
  router.get("/reports", allow("reports"), async (req, res) =>
    res.json({
      sales: await rows(
        db,
        "SELECT r.title,c.name AS course,count(i.order_id)::int AS purchases,coalesce(sum(i.price_minor),0)::int AS revenue FROM resources r JOIN courses c ON c.id=r.course_id LEFT JOIN order_items i ON i.resource_id=r.id AND i.order_id IN (SELECT id FROM orders WHERE status='completed') GROUP BY r.id,c.name ORDER BY revenue DESC LIMIT 200",
      ),
      monthly: await rows(
        db,
        "SELECT to_char(created_at AT TIME ZONE 'Africa/Nairobi','YYYY-MM') AS month,count(*)::int AS orders,sum(amount_minor)::int AS revenue FROM orders WHERE status='completed' GROUP BY month ORDER BY month DESC LIMIT 24",
      ),
    }),
  );
  router.get("/reports.csv", allow("reports"), async (req, res) => {
    const list = await rows(
      db,
      "SELECT o.id,o.created_at,u.name,o.status,o.currency,o.amount_minor FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 10000",
    );
    const keys = [
      "id",
      "created_at",
      "name",
      "status",
      "currency",
      "amount_minor",
    ];
    await audit(db, req.user.id, "report.exported", "orders", {
      count: list.length,
    });
    res
      .type("csv")
      .attachment("tvet-orders.csv")
      .send(
        [
          keys.join(","),
          ...list.map((r) => keys.map((k) => csvCell(r[k])).join(",")),
        ].join("\r\n"),
      );
  });
  router.get("/staff", superOnly, async (req, res) =>
    res.json({
      users: (
        await rows(
          db,
          "SELECT * FROM users WHERE role IN ('admin','super_admin') ORDER BY created_at",
        )
      ).map(publicUser),
      permissions,
    }),
  );
  router.post("/staff", superOnly, async (req, res) => {
    const p = identity(req.body),
      hash = await hashPassword(password(req.body.password)),
      perms = (req.body.permissions || []).filter((p) =>
        permissions.includes(p),
      ),
      uid = id();
    await db.tx(async (t) => {
      await t.query(
        "INSERT INTO users(id,name,email,phone,password_hash,role,permissions) VALUES($1,$2,$3,$4,$5,'admin',$6)",
        [uid, p.name, p.email, p.phone, hash, JSON.stringify(perms)],
      );
      await audit(t, req.user.id, "admin.created", uid);
    });
    res.json({ id: uid });
  });
  router.patch("/staff/:id", superOnly, async (req, res) => {
    await db.tx(async (t) => {
      await t.query(
        "SELECT id FROM users WHERE role='super_admin' ORDER BY id FOR UPDATE",
      );
      const u = await one(t, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      if (!u || !["admin", "super_admin"].includes(u.role))
        fail(404, "Staff account not found");
      const status = req.body.status === "suspended" ? "suspended" : "active";
      if (u.role === "super_admin" && status === "suspended") {
        const count = await one(
          t,
          "SELECT count(*)::int AS n FROM users WHERE role='super_admin' AND status='active'",
        );
        if (count.n <= 1)
          fail(409, "The last active super admin cannot be disabled");
      }
      const perms = Array.isArray(req.body.permissions)
        ? req.body.permissions.filter((p) => permissions.includes(p))
        : u.permissions;
      await t.query("UPDATE users SET status=$2,permissions=$3 WHERE id=$1", [
        u.id,
        status,
        JSON.stringify(perms),
      ]);
      await t.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await audit(t, req.user.id, "staff.updated", u.id, {
        status,
        permissions: perms,
      });
    });
    res.json({ ok: true });
  });
  router.post("/users/:id/anonymize", superOnly, async (req, res) => {
    await db.tx(async (t) => {
      const u = await one(
        t,
        "SELECT * FROM users WHERE id=$1 AND role='student' FOR UPDATE",
        [req.params.id],
      );
      if (!u) fail(404, "Student not found");
      if (req.body.confirmation !== u.email)
        fail(400, "Type the exact email to confirm");
      const reason = text(req.body.reason, 5, 1000);
      await t.query(
        "UPDATE users SET name='Deleted account',email=$2,phone=$3,password_hash=NULL,status='anonymized',institution='',course_id=NULL,avatar_key=NULL WHERE id=$1",
        [u.id, u.id + "@deleted.invalid", "deleted-" + u.id],
      );
      await t.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await audit(t, req.user.id, "user.anonymized", u.id, { reason });
    });
    res.json({ ok: true });
  });
  router.get("/settings", superOnly, async (req, res) =>
    res.json(
      Object.fromEntries(
        (await rows(db, "SELECT * FROM settings")).map((x) => [x.key, x.value]),
      ),
    ),
  );
  router.put("/settings", superOnly, async (req, res) => {
    const b = req.body;
    const pub = {
      name: text(b.public?.name, 3, 100),
      tagline: text(b.public?.tagline, 3, 200),
      support_email: String(b.public?.support_email || "").slice(0, 254),
      support_phone: String(b.public?.support_phone || "").slice(0, 30),
      developer: text(b.public?.developer, 1, 150),
    };
    const policy = {
      notice_days: num(b.policy?.notice_days, 1, 365),
      purchase_terms: text(b.policy?.purchase_terms, 10, 10000),
      refund_terms: text(b.policy?.refund_terms, 10, 10000),
      privacy_terms: text(b.policy?.privacy_terms, 10, 10000),
    };
    await db.tx(async (t) => {
      for (const [key, v] of [
        ["public", pub],
        ["policy", policy],
      ])
        await t.query("UPDATE settings SET value=$2 WHERE key=$1", [
          key,
          JSON.stringify(v),
        ]);
      await audit(t, req.user.id, "settings.updated");
    });
    res.json({ ok: true });
  });
  router.get("/audit", superOnly, async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT a.*,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500",
      ),
    ),
  );
  return router;
}
