import { id, one, rows, fail } from "../util.js";
import { notify, staffNotify } from "./notifications.js";
export async function buildOrder(db, userId) {
  return db.tx(async (t) => {
    await t.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const cart = await rows(t, "SELECT * FROM cart_items WHERE user_id=$1", [
      userId,
    ]);
    if (!cart.length) fail(400, "Your cart is empty");
    const selected = new Map();
    for (const entry of cart) {
      let resources;
      if (entry.kind === "bundle") {
        const bundle = await one(
          t,
          "SELECT * FROM bundles WHERE id=$1 AND active=true",
          [entry.item_id],
        );
        if (!bundle) fail(409, "A bundle is no longer available");
        resources = await rows(
          t,
          "SELECT r.* FROM resources r JOIN bundle_items b ON b.resource_id=r.id WHERE b.bundle_id=$1 ORDER BY r.id",
          [bundle.id],
        );
        if (!resources.length) fail(409, "This bundle has no papers");
        const sum = resources.reduce((a, r) => a + r.price_minor, 0);
        if (bundle.price_minor > sum)
          fail(409, "Bundle price needs administrator review");
        let allocated = 0;
        resources = resources.map((r, i) => {
          const price =
            i === resources.length - 1
              ? bundle.price_minor - allocated
              : Math.floor(
                  bundle.price_minor *
                    (sum ? r.price_minor / sum : 1 / resources.length),
                );
          allocated += price;
          return { ...r, price_minor: price };
        });
      } else {
        resources = await rows(t, "SELECT * FROM resources WHERE id=$1", [
          entry.item_id,
        ]);
        if (!resources.length) fail(409, "A paper is no longer available");
      }
      for (const r of resources) {
        const series = await one(
          t,
          "SELECT status FROM assessment_series WHERE id=$1 FOR UPDATE",
          [r.series_id],
        );
        const fresh = await one(
          t,
          "SELECT status,file_key FROM resources WHERE id=$1 FOR UPDATE",
          [r.id],
        );
        if (
          fresh.status !== "published" ||
          !fresh.file_key ||
          series?.status !== "open"
        )
          fail(409, "A paper is no longer available for purchase");
        if (
          await one(
            t,
            "SELECT 1 FROM entitlements WHERE user_id=$1 AND resource_id=$2",
            [userId, r.id],
          )
        )
          fail(
            409,
            "You already own a paper in this cart. Remove it or select individual unowned papers.",
          );
        if (selected.has(r.id))
          fail(
            409,
            "The cart contains overlapping papers. Remove the duplicate paper or bundle.",
          );
        selected.set(r.id, r);
      }
    }
    const pending = await one(
      t,
      "SELECT o.id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.user_id=$1 AND o.status IN ('initiated','pending','needs_review') AND i.resource_id=ANY($2::text[]) LIMIT 1",
      [userId, [...selected.keys()]],
    );
    if (pending)
      fail(
        409,
        "A previous order for these papers is unresolved. Open Purchase History to resume or contact Support.",
      );
    const order = {
      id: id(),
      user_id: userId,
      amount_minor: [...selected.values()].reduce(
        (a, r) => a + r.price_minor,
        0,
      ),
      currency: "KES",
    };
    await t.query(
      "INSERT INTO orders(id,user_id,amount_minor) VALUES($1,$2,$3)",
      [order.id, userId, order.amount_minor],
    );
    for (const r of selected.values())
      await t.query(
        "INSERT INTO order_items(order_id,resource_id,title,price_minor) VALUES($1,$2,$3,$4)",
        [order.id, r.id, r.title, r.price_minor],
      );
    await t.query("DELETE FROM cart_items WHERE user_id=$1", [userId]);
    if (!order.amount_minor) await fulfill(t, order);
    return order;
  });
}
async function fulfill(t, order) {
  const items = await rows(
    t,
    "SELECT r.*,s.status AS series_status FROM order_items i JOIN resources r ON r.id=i.resource_id JOIN assessment_series s ON s.id=r.series_id WHERE i.order_id=$1",
    [order.id],
  );
  if (
    items.some(
      (r) =>
        !r.file_key ||
        r.status === "deleted" ||
        ["deleting", "deleted"].includes(r.series_status),
    )
  ) {
    await t.query(
      "UPDATE orders SET status='needs_review',updated_at=now() WHERE id=$1",
      [order.id],
    );
    await staffNotify(
      t,
      "Payment needs resolution",
      "A paid order cannot be fulfilled because a document is unavailable. Review order " +
        order.id,
    );
    return "needs_review";
  }
  for (const r of items)
    await t.query(
      "INSERT INTO entitlements(user_id,resource_id,order_id) VALUES($1,$2,$3) ON CONFLICT(user_id,resource_id) DO UPDATE SET state='active',order_id=EXCLUDED.order_id",
      [order.user_id, r.id, order.id],
    );
  await t.query(
    "UPDATE orders SET status='completed',updated_at=now() WHERE id=$1",
    [order.id],
  );
  await t.query(
    "INSERT INTO receipts(id,order_id) VALUES($1,$2) ON CONFLICT(order_id) DO NOTHING",
    [id(), order.id],
  );
  await notify(t, {
    users: [order.user_id],
    title: "Your papers are ready",
    message:
      "Payment confirmed. Your purchased papers are available in My Papers.",
    link: "/account/papers",
  });
  await staffNotify(
    t,
    "Order completed",
    "Order " + order.id + " was confirmed.",
  );
  return "completed";
}
export async function reconcile(db, provider, tracking) {
  const attempt = await one(
    db,
    "SELECT * FROM payment_attempts WHERE tracking_id=$1",
    [tracking],
  );
  if (!attempt) fail(404, "Unknown payment reference");
  const status = await provider.status(tracking);
  return db.tx(async (t) => {
    const a = await one(
      t,
      "SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE",
      [attempt.id],
    );
    const order = await one(t, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      a.order_id,
    ]);
    const amount = Math.round(Number(status.amount) * 100);
    if (
      status.merchant_reference !== a.id ||
      status.currency !== order.currency ||
      !Number.isFinite(amount) ||
      amount !== order.amount_minor
    )
      fail(
        409,
        "Payment details do not match the order. Access remains locked.",
      );
    const state = Number(status.status_code);
    await t.query(
      "INSERT INTO payment_events(id,attempt_id,state,amount_minor,currency,reference) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id(),
        a.id,
        String(state),
        amount,
        status.currency,
        status.confirmation_code || "",
      ],
    );
    await t.query(
      "UPDATE payment_attempts SET checked_at=now(),state=$2 WHERE id=$1",
      [a.id, String(state)],
    );
    if (state === 3) {
      if (order.status === "reversed") return "reversed";
      await t.query(
        "UPDATE orders SET status='reversed',updated_at=now() WHERE id=$1",
        [order.id],
      );
      await t.query(
        "UPDATE entitlements SET state='revoked' WHERE order_id=$1",
        [order.id],
      );
      await notify(t, {
        users: [order.user_id],
        title: "Payment reversed",
        message:
          "The payment provider reports a reversal. Access for the affected order has been revoked. Contact Support if this is unexpected.",
      });
      return "reversed";
    }
    if (["completed", "reversed"].includes(order.status)) return order.status;
    if (state === 1) return fulfill(t, order);
    if (order.status === "needs_review") return order.status;
    const next = state === 2 ? "failed" : "pending";
    await t.query("UPDATE orders SET status=$2,updated_at=now() WHERE id=$1", [
      order.id,
      next,
    ]);
    return next;
  });
}
export async function startPayment(db, provider, order, user) {
  if (!provider.configured())
    fail(
      503,
      "Pesapal is not configured. Your order is saved in Purchase History; no payment was taken.",
    );
  const a = await db.tx(async (t) => {
    const o = await one(t, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      order.id,
    ]);
    if (!["initiated", "pending", "failed"].includes(o.status))
      fail(409, "This order cannot start a new payment");
    const existing = await one(
      t,
      "SELECT * FROM payment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1",
      [o.id],
    );
    // Reuse the original checkout; never create concurrent charges for one order.
    if (existing) {
      if (existing.redirect_url) return existing;
      fail(
        409,
        "Payment initiation is unresolved. Contact Support before trying again.",
      );
    }
    const a = { id: id(), order_id: o.id };
    await t.query("INSERT INTO payment_attempts(id,order_id) VALUES($1,$2)", [
      a.id,
      a.order_id,
    ]);
    return a;
  });
  if (a.redirect_url) return { redirect_url: a.redirect_url };
  let r;
  try {
    r = await provider.submit(a, order, user);
  } catch (e) {
    await db.query(
      "UPDATE payment_attempts SET state='submission_unknown',failure='Provider submission failed or timed out. Reconcile by merchant reference before retry.' WHERE id=$1",
      [a.id],
    );
    throw e;
  }
  await db.tx(async (t) => {
    await t.query(
      "UPDATE payment_attempts SET tracking_id=$2,redirect_url=$3,state='pending' WHERE id=$1",
      [a.id, r.order_tracking_id, r.redirect_url],
    );
    await t.query("UPDATE orders SET status='pending' WHERE id=$1", [order.id]);
  });
  return { redirect_url: r.redirect_url };
}
