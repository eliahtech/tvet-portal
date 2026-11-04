import { Router } from "express";
import {
  id,
  one,
  rows,
  fail,
  publicUser,
  hashPassword,
  verifyPassword,
  audit,
} from "./util.js";
import { requireUser, text, password, identity, newSession } from "./auth.js";
import { resourceSelect } from "./routes-public.js";
import { buildOrder, startPayment, reconcile } from "./services/orders.js";
import { notify, staffNotify } from "./services/notifications.js";
export function accountRoutes({ db, files, provider, upload }) {
  const router = Router();
  router.use(requireUser);
  router.get("/summary", async (req, res) => {
    res.json({
      papers: (
        await one(
          db,
          "SELECT count(*)::int AS n FROM entitlements WHERE user_id=$1 AND state='active'",
          [req.user.id],
        )
      ).n,
      spent: (
        await one(
          db,
          "SELECT coalesce(sum(amount_minor),0)::int AS n FROM orders WHERE user_id=$1 AND status='completed'",
          [req.user.id],
        )
      ).n,
      unread: (
        await one(
          db,
          "SELECT count(*)::int AS n FROM notification_recipients WHERE user_id=$1 AND read_at IS NULL",
          [req.user.id],
        )
      ).n,
      requests: (
        await one(
          db,
          "SELECT count(*)::int AS n FROM paper_requests WHERE user_id=$1",
          [req.user.id],
        )
      ).n,
    });
  });
  router.put("/profile", async (req, res) => {
    const p = identity(req.body);
    if (p.email !== req.user.email || p.phone !== req.user.phone) {
      if (
        !(await verifyPassword(
          String(req.body.current_password || ""),
          req.user.password_hash,
        ))
      )
        fail(403, "Enter your current password to change contact details");
    }
    const course = req.body.course_id || null;
    if (
      course &&
      !(await one(db, "SELECT id FROM courses WHERE id=$1", [course]))
    )
      fail(400, "Choose a valid course");
    await db.query(
      "UPDATE users SET name=$2,email=$3,phone=$4,institution=$5,course_id=$6,level=$7,profile_completed_at=coalesce(profile_completed_at,now()) WHERE id=$1",
      [
        req.user.id,
        p.name,
        p.email,
        p.phone,
        String(req.body.institution || "").slice(0, 150),
        course,
        String(req.body.level || "").slice(0, 100),
      ],
    );
    res.json({
      user: publicUser(
        await one(db, "SELECT * FROM users WHERE id=$1", [req.user.id]),
      ),
    });
  });
  router.post("/avatar", upload.single("file"), async (req, res) => {
    const b = req.file?.buffer;
    if (!b) fail(400, "Choose an image");
    let ext;
    if (
      b.length < 2 * 1024 * 1024 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      ext = "png";
    else if (
      b.length < 2 * 1024 * 1024 &&
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255
    )
      ext = "jpg";
    else fail(400, "Use a PNG or JPEG smaller than 2 MB");
    const key = await files.put(b, ext, "avatars");
    await db.query("UPDATE users SET avatar_key=$2 WHERE id=$1", [
      req.user.id,
      key,
    ]);
    if (req.user.avatar_key) await files.remove(req.user.avatar_key);
    res.json({ ok: true });
  });
  router.get("/avatar", async (req, res) => {
    if (!req.user.avatar_key) fail(404, "No avatar");
    res
      .set("Cache-Control", "private,no-store")
      .type(req.user.avatar_key.endsWith(".png") ? "png" : "jpg")
      .send(await files.get(req.user.avatar_key));
  });
  router.post("/password", async (req, res) => {
    if (
      req.user.password_hash &&
      !(await verifyPassword(
        String(req.body.current_password || ""),
        req.user.password_hash,
      ))
    )
      fail(403, "Current password is incorrect");
    const hash = await hashPassword(password(req.body.password));
    await db.tx(async (t) => {
      await t.query(
        "UPDATE users SET password_hash=$2,profile_completed_at=coalesce(profile_completed_at,now()) WHERE id=$1",
        [req.user.id, hash],
      );
      await t.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
    });
    const csrf = await newSession(db, req, res, req.user.id);
    await audit(db, req.user.id, "password.changed", req.user.id);
    res.json({ ok: true, csrf });
  });
  router.get("/sessions", async (req, res) =>
    res.json(
      (
        await rows(
          db,
          "SELECT id,user_agent,created_at,expires_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC",
          [req.user.id],
        )
      ).map((s) => ({ ...s, current: s.id === req.sessionId })),
    ),
  );
  router.delete("/sessions/:id", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  });
  router.get("/papers", async (req, res) => {
    const params = [req.user.id],
      filter = req.query.q ? " AND (r.title ILIKE $2 OR u.name ILIKE $2)" : "";
    if (filter) params.push("%" + String(req.query.q).slice(0, 100) + "%");
    const items = await rows(
      db,
      resourceSelect.replace(
        "SELECT r.id",
        "SELECT e.purchased_at,e.state AS access_state,r.id",
      ) +
        " JOIN entitlements e ON e.resource_id=r.id WHERE e.user_id=$1" +
        filter +
        " ORDER BY e.purchased_at DESC LIMIT 200",
      params,
    );
    const notices = await rows(
      db,
      "SELECT j.id,j.execute_after,j.reason,s.name AS series,s.id AS series_id FROM deletion_jobs j JOIN assessment_series s ON s.id=j.series_id JOIN deletion_recipients d ON d.job_id=j.id WHERE d.user_id=$1 AND j.status IN ('scheduled','running')",
      [req.user.id],
    );
    res.json({ items, notices });
  });
  router.get("/wishlist", async (req, res) =>
    res.json(
      await rows(
        db,
        resourceSelect +
          " JOIN wishlists w ON w.resource_id=r.id WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT 200",
        [req.user.id],
      ),
    ),
  );
  router.post("/wishlist/:id", async (req, res) => {
    if (
      !(await one(db, "SELECT id FROM resources WHERE id=$1", [req.params.id]))
    )
      fail(404, "Paper not found");
    await db.query(
      "INSERT INTO wishlists(user_id,resource_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [req.user.id, req.params.id],
    );
    res.json({ ok: true });
  });
  router.delete("/wishlist/:id", async (req, res) => {
    await db.query(
      "DELETE FROM wishlists WHERE user_id=$1 AND resource_id=$2",
      [req.user.id, req.params.id],
    );
    res.json({ ok: true });
  });
  router.get("/cart", async (req, res) => {
    const items = await rows(db, "SELECT * FROM cart_items WHERE user_id=$1", [
      req.user.id,
    ]);
    for (const i of items) {
      const table = i.kind === "bundle" ? "bundles" : "resources";
      const item = await one(
        db,
        "SELECT title,price_minor FROM " + table + " WHERE id=$1",
        [i.item_id],
      );
      Object.assign(i, item || { title: "Unavailable item", price_minor: 0 });
    }
    res.json(items);
  });
  router.post("/cart", async (req, res) => {
    const kind = req.body.kind === "bundle" ? "bundle" : "resource",
      table = kind === "bundle" ? "bundles" : "resources";
    const item = await one(db, "SELECT * FROM " + table + " WHERE id=$1", [
      text(req.body.item_id),
    ]);
    if (!item) fail(404, "Item not found");
    await db.query(
      "INSERT INTO cart_items(user_id,item_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [req.user.id, item.id, kind],
    );
    res.json({ ok: true });
  });
  router.delete("/cart/:id", async (req, res) => {
    await db.query("DELETE FROM cart_items WHERE user_id=$1 AND item_id=$2", [
      req.user.id,
      req.params.id,
    ]);
    res.json({ ok: true });
  });
  router.post("/checkout", async (req, res) => {
    if (!req.user.password_hash)
      fail(403, "Set your account password before checkout");
    if (req.body.accept_terms !== true)
      fail(400, "Accept the purchase and access terms before payment");
    const order = await buildOrder(db, req.user.id);
    if (!order.amount_minor) return res.json({ order, free: true });
    try {
      res.json({
        order,
        ...(await startPayment(db, provider, order, req.user)),
      });
    } catch (e) {
      e.order_id = order.id;
      throw e;
    }
  });
  router.get("/orders", async (req, res) => {
    const list = await rows(
      db,
      "SELECT o.*,r.id AS receipt_id FROM orders o LEFT JOIN receipts r ON r.order_id=o.id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 200",
      [req.user.id],
    );
    for (const o of list)
      o.items = await rows(db, "SELECT * FROM order_items WHERE order_id=$1", [
        o.id,
      ]);
    res.json(list);
  });
  router.post("/orders/:id/pay", async (req, res) => {
    if (!req.user.password_hash) fail(403, "Set your password first");
    const order = await one(
      db,
      "SELECT * FROM orders WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!order) fail(404, "Order not found");
    res.json(await startPayment(db, provider, order, req.user));
  });
  router.post("/orders/:id/check", async (req, res) => {
    const a = await one(
      db,
      "SELECT a.* FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.id=$1 AND o.user_id=$2 ORDER BY a.created_at DESC LIMIT 1",
      [req.params.id, req.user.id],
    );
    if (!a?.tracking_id)
      fail(409, "This order has no submitted payment to check");
    res.json({ status: await reconcile(db, provider, a.tracking_id) });
  });
  router.post("/orders/:id/cancel", async (req, res) => {
    await db.tx(async (t) => {
      const o = await one(
        t,
        "SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [req.params.id, req.user.id],
      );
      if (!o) fail(404, "Order not found");
      if (
        o.status !== "initiated" ||
        (await one(t, "SELECT 1 FROM payment_attempts WHERE order_id=$1", [
          o.id,
        ]))
      )
        fail(409, "Submitted payments must be reconciled before cancellation");
      await t.query("UPDATE orders SET status='cancelled' WHERE id=$1", [o.id]);
    });
    res.json({ ok: true });
  });
  router.get("/receipts/:id", async (req, res) => {
    const receipt = await one(
      db,
      "SELECT r.*,o.amount_minor,o.currency,o.status,o.user_id,u.name FROM receipts r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.user_id WHERE r.id=$1 AND o.user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!receipt) fail(404, "Receipt not found");
    receipt.items = await rows(
      db,
      "SELECT title,price_minor FROM order_items WHERE order_id=$1",
      [receipt.order_id],
    );
    res.json(receipt);
  });
  router.get("/notifications", async (req, res) => {
    const p = Math.max(1, Number(req.query.page) || 1);
    res.json(
      await rows(
        db,
        "SELECT n.*,r.read_at FROM notifications n JOIN notification_recipients r ON r.notification_id=n.id WHERE r.user_id=$1 ORDER BY n.created_at DESC LIMIT 50 OFFSET $2",
        [req.user.id, (p - 1) * 50],
      ),
    );
  });
  router.post("/notifications/read", async (req, res) => {
    await db.query(
      "UPDATE notification_recipients SET read_at=now() WHERE user_id=$1" +
        (req.body.id ? " AND notification_id=$2" : ""),
      req.body.id ? [req.user.id, req.body.id] : [req.user.id],
    );
    res.json({ ok: true });
  });
  router.get("/requests", async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT p.*,c.name AS course FROM paper_requests p LEFT JOIN courses c ON c.id=p.course_id WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
        [req.user.id],
      ),
    ),
  );
  router.post("/requests", async (req, res) => {
    await db.tx(async (t) => {
      await t.query(
        "INSERT INTO paper_requests(id,user_id,course_id,unit,details) VALUES($1,$2,$3,$4,$5)",
        [
          id(),
          req.user.id,
          req.body.course_id || null,
          text(req.body.unit, 2, 200),
          text(req.body.details, 5, 2000),
        ],
      );
      await staffNotify(
        t,
        "New paper request",
        "A student requested a study resource.",
        "/admin/requests",
      );
    });
    res.json({ ok: true });
  });
  router.get("/tickets", async (req, res) => {
    const tickets = await rows(
      db,
      "SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.user.id],
    );
    for (const t of tickets)
      t.messages = await rows(
        db,
        "SELECT m.id,m.message,m.created_at,u.name,u.role FROM ticket_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=$1 ORDER BY m.created_at",
        [t.id],
      );
    res.json(tickets);
  });
  router.post("/tickets", async (req, res) => {
    const tid = id();
    await db.tx(async (t) => {
      await t.query(
        "INSERT INTO support_tickets(id,user_id,subject,resource_id) VALUES($1,$2,$3,$4)",
        [
          tid,
          req.user.id,
          text(req.body.subject, 3, 200),
          req.body.resource_id || null,
        ],
      );
      await t.query(
        "INSERT INTO ticket_messages(id,ticket_id,user_id,message) VALUES($1,$2,$3,$4)",
        [id(), tid, req.user.id, text(req.body.message, 5, 4000)],
      );
      await staffNotify(
        t,
        "New support ticket",
        req.body.subject,
        "/admin/support",
      );
    });
    res.json({ id: tid });
  });
  router.post("/tickets/:id/reply", async (req, res) => {
    if (
      !(await one(
        db,
        "SELECT id FROM support_tickets WHERE id=$1 AND user_id=$2",
        [req.params.id, req.user.id],
      ))
    )
      fail(404, "Ticket not found");
    await db.tx(async (t) => {
      await t.query(
        "INSERT INTO ticket_messages(id,ticket_id,user_id,message) VALUES($1,$2,$3,$4)",
        [id(), req.params.id, req.user.id, text(req.body.message, 1, 4000)],
      );
      await t.query("UPDATE support_tickets SET status='open' WHERE id=$1", [
        req.params.id,
      ]);
      await staffNotify(
        t,
        "Support reply received",
        "A student replied to a support ticket.",
        "/admin/support",
      );
    });
    res.json({ ok: true });
  });
  return router;
}
