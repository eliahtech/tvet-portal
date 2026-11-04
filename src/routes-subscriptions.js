import { Router } from "express";
import { id, one, rows, fail, audit } from "./util.js";
import { superOnly, text } from "./auth.js";
import {
  subscriptionState,
  createSubscriptionOrder,
  startSubscriptionPayment,
  reconcileSubscription,
} from "./services/subscriptions.js";
export function subscriptionRoutes({ db, ownerProvider }) {
  const r = Router();
  r.all("/ipn", async (req, res) => {
    const p = req.method === "POST" ? req.body : req.query,
      tracking = text(p.OrderTrackingId, 10, 100);
    await reconcileSubscription(db, ownerProvider, tracking);
    res.json({
      orderNotificationType: "IPNCHANGE",
      orderTrackingId: tracking,
      orderMerchantReference: p.OrderMerchantReference,
      status: 200,
    });
  });
  r.use((req, res, next) => {
    if (!["admin", "super_admin"].includes(req.user?.role))
      fail(403, "Staff account required");
    next();
  });
  r.get("/me", async (req, res) => {
    if (req.user.role === "super_admin")
      return res.json({
        exempt: true,
        active: true,
        owner_configured: ownerProvider.configured(),
      });
    res.json({
      ...(await subscriptionState(db, req.user.id)),
      owner_configured: ownerProvider.configured(),
      orders: await rows(
        db,
        "SELECT o.*,a.id AS attempt_id,a.tracking_id,a.state AS attempt_state,p.starts_at,p.ends_at,p.revoked FROM subscription_orders o LEFT JOIN subscription_attempts a ON a.order_id=o.id LEFT JOIN subscription_periods p ON p.order_id=o.id WHERE o.admin_id=$1 ORDER BY o.created_at DESC LIMIT 200",
        [req.user.id],
      ),
    });
  });
  r.get("/manage", superOnly, async (req, res) => {
    const plan = (
        await one(
          db,
          "SELECT value FROM settings WHERE key='subscription_plan'",
        )
      ).value,
      admins = await rows(
        db,
        "SELECT id,name,email,status FROM users WHERE role='admin' ORDER BY name",
      );
    for (const a of admins) a.subscription = await subscriptionState(db, a.id);
    res.json({
      plan,
      owner_configured: ownerProvider.configured(),
      admins,
      orders: await rows(
        db,
        "SELECT o.*,u.name,u.email,a.id AS attempt_id,a.tracking_id,a.state AS attempt_state,p.starts_at,p.ends_at,p.revoked FROM subscription_orders o JOIN users u ON u.id=o.admin_id LEFT JOIN subscription_attempts a ON a.order_id=o.id LEFT JOIN subscription_periods p ON p.order_id=o.id ORDER BY o.created_at DESC LIMIT 500",
      ),
    });
  });
  r.put("/plan", superOnly, async (req, res) => {
    const b = req.body,
      amount = Number(b.amount_minor),
      days = Number(b.period_days);
    if (
      typeof b.enabled !== "boolean" ||
      b.amount_minor === null ||
      b.amount_minor === "" ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > 100000000 ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366
    )
      fail(400, "Enter a valid fee and billing period");
    if (b.enabled && (!amount || !ownerProvider.configured()))
      fail(
        400,
        "Set a positive fee and configure the owner’s Pesapal account before enabling subscriptions",
      );
    const plan = {
      name: text(b.name, 3, 100),
      terms: text(b.terms, 10, 3000),
      enabled: b.enabled,
      amount_minor: amount,
      currency: "KES",
      period_days: days,
      version: id(),
    };
    await db.tx(async (t) => {
      await t.query(
        "UPDATE settings SET value=$1 WHERE key='subscription_plan'",
        [JSON.stringify(plan)],
      );
      await audit(t, req.user.id, "subscription.plan.updated", "", {
        enabled: plan.enabled,
        amount_minor: amount,
        period_days: days,
      });
    });
    res.json({ plan });
  });
  r.post("/checkout", async (req, res) => {
    if (req.user.role !== "admin")
      fail(403, "Only normal admins purchase admin subscriptions");
    res.json(
      await createSubscriptionOrder(db, ownerProvider, req.user, req.body),
    );
  });
  async function ownOrder(req) {
    const order = await one(
      db,
      "SELECT * FROM subscription_orders WHERE id=$1 AND admin_id=$2",
      [req.params.id, req.user.id],
    );
    if (!order) fail(404, "Subscription order not found");
    return order;
  }
  r.post("/orders/:id/pay", async (req, res) => {
    const o = await ownOrder(req);
    res.json(await startSubscriptionPayment(db, ownerProvider, o, req.user));
  });
  r.post("/orders/:id/check", async (req, res) => {
    await ownOrder(req);
    const a = await one(
      db,
      "SELECT * FROM subscription_attempts WHERE order_id=$1",
      [req.params.id],
    );
    if (!a?.tracking_id)
      fail(
        409,
        "This submission needs super-admin reference recovery before verification",
      );
    res.json({
      status: await reconcileSubscription(db, ownerProvider, a.tracking_id),
    });
  });
  r.get("/receipts/:id", async (req, res) => {
    const o = await one(
      db,
      "SELECT o.*,u.name,p.starts_at,p.ends_at,p.revoked FROM subscription_orders o JOIN users u ON u.id=o.admin_id LEFT JOIN subscription_periods p ON p.order_id=o.id WHERE o.receipt_id=$1",
      [req.params.id],
    );
    if (!o || (req.user.role !== "super_admin" && o.admin_id !== req.user.id))
      fail(404, "Receipt not found");
    res.json(o);
  });
  r.post("/manage/orders/:id/check", superOnly, async (req, res) => {
    const a = await one(
      db,
      "SELECT * FROM subscription_attempts WHERE order_id=$1",
      [req.params.id],
    );
    if (!a?.tracking_id)
      fail(409, "No provider reference is linked to this order");
    const status = await reconcileSubscription(
      db,
      ownerProvider,
      a.tracking_id,
    );
    await audit(db, req.user.id, "subscription.reconciled", req.params.id);
    res.json({ status });
  });
  r.post("/manage/orders/:id/link", superOnly, async (req, res) => {
    const a = await one(
      db,
      "SELECT * FROM subscription_attempts WHERE order_id=$1",
      [req.params.id],
    );
    if (!a || a.tracking_id)
      fail(409, "Only an unresolved submission can be linked");
    const tracking = text(req.body.tracking_id, 10, 100),
      v = await ownerProvider.status(tracking);
    const o = await one(db, "SELECT * FROM subscription_orders WHERE id=$1", [
      a.order_id,
    ]);
    if (
      v.merchant_reference !== a.id ||
      v.currency !== o.currency ||
      Math.round(Number(v.amount) * 100) !== o.amount_minor
    )
      fail(409, "Provider details do not match this subscription");
    await db.query(
      "UPDATE subscription_attempts SET tracking_id=$2 WHERE id=$1 AND tracking_id IS NULL",
      [a.id, tracking],
    );
    const status = await reconcileSubscription(db, ownerProvider, tracking);
    await audit(db, req.user.id, "subscription.reference.recovered", o.id);
    res.json({ status });
  });
  return r;
}
