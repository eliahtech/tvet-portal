import { Pesapal } from "./pesapal.js";
import { id, one, rows, fail, audit } from "../util.js";
import { notify } from "./notifications.js";
export function ownerPesapal() {
  return new Pesapal({
    key: process.env.OWNER_PESAPAL_CONSUMER_KEY || "",
    secret: process.env.OWNER_PESAPAL_CONSUMER_SECRET || "",
    ipn: process.env.OWNER_PESAPAL_IPN_ID || "",
    environment: process.env.OWNER_PESAPAL_ENV || "sandbox",
    ipnPath: "/api/subscriptions/ipn",
    callbackPath: "/payments/subscription-callback",
    cancellationPath: "/admin/subscription",
    descriptionPrefix: "TVET admin subscription",
  });
}
export async function subscriptionState(
  db,
  adminId,
  { clock = new Date() } = {},
) {
  const plan = (
    await one(db, "SELECT value FROM settings WHERE key='subscription_plan'")
  ).value;
  const periods = await rows(
    db,
    "SELECT * FROM subscription_periods WHERE admin_id=$1 AND revoked=false ORDER BY starts_at",
    [adminId],
  );
  let current = periods.find(
      (p) => new Date(p.starts_at) <= clock && new Date(p.ends_at) > clock,
    ),
    expiry = current ? new Date(current.ends_at) : null,
    last = current;
  if (current)
    for (const p of periods) {
      if (new Date(p.starts_at) <= expiry && new Date(p.ends_at) > expiry) {
        expiry = new Date(p.ends_at);
        last = p;
      }
    }
  const active = !plan.enabled || !!current;
  const next = periods.find((p) => new Date(p.starts_at) > clock);
  return {
    plan,
    enabled: plan.enabled,
    active,
    status: !plan.enabled
      ? "not_required"
      : current
        ? "active"
        : periods.some((p) => new Date(p.ends_at) <= clock)
          ? "expired"
          : "payment_required",
    expires_at: expiry?.toISOString() || null,
    next_starts_at: !current && next ? next.starts_at : null,
    period_id: last?.id || periods.at(-1)?.id || null,
    days_remaining: expiry
      ? Math.max(0, Math.ceil((expiry - clock) / 86400000))
      : 0,
  };
}
async function superNotify(db, title, message) {
  const users = await rows(
    db,
    "SELECT id FROM users WHERE role='super_admin' AND status='active'",
  );
  return notify(db, {
    users: users.map((u) => u.id),
    title,
    message,
    link: "/admin/subscriptions",
  });
}
export async function createSubscriptionOrder(
  db,
  provider,
  user,
  { plan_version, accept_terms },
) {
  if (!provider.configured())
    fail(
      503,
      "The platform owner’s Pesapal account is not configured. Contact the super admin. No payment was taken.",
    );
  if (accept_terms !== true)
    fail(400, "Accept the subscription terms before payment");
  const order = await db.tx(async (t) => {
    await t.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    const plan = (
      await one(
        t,
        "SELECT value FROM settings WHERE key='subscription_plan' FOR UPDATE",
      )
    ).value;
    if (!plan.enabled)
      fail(409, "Admin subscriptions are not currently required");
    if (plan.version !== plan_version)
      fail(
        409,
        "The subscription plan changed. Refresh and review the new amount before paying.",
      );
    const pending = await one(
      t,
      "SELECT id FROM subscription_orders WHERE admin_id=$1 AND status IN ('initiated','pending','submission_unknown','failed','needs_review') LIMIT 1",
      [user.id],
    );
    if (pending)
      fail(
        409,
        "Resolve or resume your existing subscription order before creating another payment",
      );
    const order = {
      id: id(),
      admin_id: user.id,
      amount_minor: plan.amount_minor,
      currency: plan.currency,
      period_days: plan.period_days,
    };
    await t.query(
      "INSERT INTO subscription_orders(id,admin_id,plan_name,plan_version,terms,amount_minor,currency,period_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        order.id,
        user.id,
        plan.name,
        plan.version,
        plan.terms,
        plan.amount_minor,
        plan.currency,
        plan.period_days,
      ],
    );
    return order;
  });
  return {
    order,
    ...(await startSubscriptionPayment(db, provider, order, user)),
  };
}
export async function startSubscriptionPayment(db, provider, order, user) {
  if (!provider.configured())
    fail(
      503,
      "The owner’s payment account is unavailable. No new payment was taken.",
    );
  const a = await db.tx(async (t) => {
    const o = await one(
      t,
      "SELECT * FROM subscription_orders WHERE id=$1 AND admin_id=$2 FOR UPDATE",
      [order.id, user.id],
    );
    if (!o) fail(404, "Subscription order not found");
    if (
      !["initiated", "pending", "failed", "submission_unknown"].includes(
        o.status,
      )
    )
      fail(409, "This subscription order cannot start another payment");
    const previous = await one(
      t,
      "SELECT * FROM subscription_attempts WHERE order_id=$1",
      [o.id],
    );
    if (previous) {
      if (previous.redirect_url) return previous;
      fail(
        409,
        "This payment submission is unresolved. Ask the super admin to recover its provider reference before retrying.",
      );
    }
    const a = { id: id(), order_id: o.id };
    await t.query(
      "INSERT INTO subscription_attempts(id,order_id) VALUES($1,$2)",
      [a.id, o.id],
    );
    return a;
  });
  if (a.redirect_url) return { redirect_url: a.redirect_url };
  try {
    const r = await provider.submit(a, order, user);
    await db.tx(async (t) => {
      await t.query(
        "UPDATE subscription_attempts SET tracking_id=$2,redirect_url=$3,state='pending' WHERE id=$1",
        [a.id, r.order_tracking_id, r.redirect_url],
      );
      await t.query(
        "UPDATE subscription_orders SET status='pending',updated_at=now() WHERE id=$1",
        [order.id],
      );
    });
    return { redirect_url: r.redirect_url };
  } catch (e) {
    await db.tx(async (t) => {
      await t.query(
        "UPDATE subscription_attempts SET state='submission_unknown' WHERE id=$1 AND tracking_id IS NULL",
        [a.id],
      );
      await t.query(
        "UPDATE subscription_orders SET status='submission_unknown' WHERE id=$1 AND status='initiated'",
        [order.id],
      );
    });
    throw e;
  }
}
export async function reconcileSubscription(db, provider, tracking) {
  const attempt = await one(
    db,
    "SELECT * FROM subscription_attempts WHERE tracking_id=$1",
    [tracking],
  );
  if (!attempt) fail(404, "Unknown subscription payment reference");
  const verified = await provider.status(tracking);
  return db.tx(async (t) => {
    const a = await one(
      t,
      "SELECT * FROM subscription_attempts WHERE id=$1 FOR UPDATE",
      [attempt.id],
    );
    const order = await one(
      t,
      "SELECT * FROM subscription_orders WHERE id=$1 FOR UPDATE",
      [a.order_id],
    );
    const amount = Math.round(Number(verified.amount) * 100),
      state = Number(verified.status_code);
    if (
      verified.merchant_reference !== a.id ||
      verified.currency !== order.currency ||
      !Number.isFinite(amount) ||
      amount !== order.amount_minor
    )
      fail(
        409,
        "Subscription payment details do not match. Access has not been changed.",
      );
    await t.query(
      "INSERT INTO subscription_events(id,attempt_id,provider_status,reference,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id(),
        a.id,
        Number.isInteger(state) ? state : 0,
        String(verified.confirmation_code || "").slice(0, 200),
        amount,
        verified.currency,
      ],
    );
    await t.query(
      "UPDATE subscription_attempts SET checked_at=now(),state=$2 WHERE id=$1",
      [a.id, String(state)],
    );
    if (state === 3) {
      if (order.status === "reversed") return "reversed";
      await t.query(
        "UPDATE subscription_orders SET status='reversed',updated_at=now() WHERE id=$1",
        [order.id],
      );
      await t.query(
        "UPDATE subscription_periods SET revoked=true WHERE order_id=$1",
        [order.id],
      );
      await notify(t, {
        users: [order.admin_id],
        title: "Subscription payment reversed",
        message:
          "Pesapal reports a reversal. The access period linked to this payment has been revoked.",
        link: "/admin/subscription",
        priority: "urgent",
      });
      await superNotify(
        t,
        "Subscription payment reversed",
        "Review subscription order " + order.id,
      );
      return "reversed";
    }
    if (["completed", "reversed"].includes(order.status)) return order.status;
    if (state !== 1) {
      const next = state === 2 ? "failed" : "pending";
      await t.query(
        "UPDATE subscription_orders SET status=$2,updated_at=now() WHERE id=$1",
        [order.id, next],
      );
      return next;
    }
    const admin = await one(
      t,
      "SELECT id,role FROM users WHERE id=$1 FOR UPDATE",
      [order.admin_id],
    );
    if (admin.role !== "admin") {
      await t.query(
        "UPDATE subscription_orders SET status='needs_review' WHERE id=$1",
        [order.id],
      );
      await superNotify(
        t,
        "Subscription needs review",
        "A confirmed payment belongs to a user whose role changed. Review order " +
          order.id,
      );
      return "needs_review";
    }
    const prior = await one(
      t,
      "SELECT max(ends_at) AS expiry FROM subscription_periods WHERE admin_id=$1 AND revoked=false",
      [admin.id],
    );
    const now = (await one(t, "SELECT now() AS current_time")).current_time;
    const start = new Date(
        Math.max(+new Date(now), prior.expiry ? +new Date(prior.expiry) : 0),
      ),
      end = new Date(+start + order.period_days * 86400000);
    await t.query(
      "INSERT INTO subscription_periods(id,order_id,admin_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id) DO NOTHING",
      [id(), order.id, admin.id, start.toISOString(), end.toISOString()],
    );
    await t.query(
      "UPDATE subscription_orders SET status='completed',receipt_id=coalesce(receipt_id,$2),updated_at=now() WHERE id=$1",
      [order.id, id()],
    );
    await notify(t, {
      users: [admin.id],
      title: "Admin subscription renewed",
      message:
        "Payment confirmed. This renewal adds " +
        order.period_days +
        " days, from " +
        start.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" }) +
        " until " +
        end.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) +
        ".",
      link: "/admin/subscription",
    });
    await superNotify(
      t,
      "Admin subscription payment confirmed",
      admin.id +
        " paid " +
        (order.amount_minor / 100).toFixed(2) +
        " " +
        order.currency +
        ". Order " +
        order.id,
    );
    await audit(t, null, "subscription.payment.confirmed", order.id, {
      days: order.period_days,
    });
    return "completed";
  });
}
export async function subscriptionReminders(db) {
  const plan = (
    await one(db, "SELECT value FROM settings WHERE key='subscription_plan'")
  ).value;
  if (!plan.enabled) return 0;
  const admins = await rows(
    db,
    "SELECT id FROM users WHERE role='admin' AND status='active'",
  );
  let sent = 0;
  for (const admin of admins) {
    const s = await subscriptionState(db, admin.id);
    const kind =
      s.active && s.days_remaining <= 3
        ? "expiring"
        : !s.active && s.status === "expired"
          ? "expired"
          : null;
    if (!kind || !s.period_id) continue;
    await db.tx(async (t) => {
      const inserted = await t.query(
        "INSERT INTO subscription_reminders(id,admin_id,period_id,kind) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
        [id(), admin.id, s.period_id, kind],
      );
      if (!inserted.rows.length) return;
      await notify(t, {
        users: [admin.id],
        title:
          kind === "expiring"
            ? "Admin subscription expires soon"
            : "Admin subscription expired",
        message:
          kind === "expiring"
            ? "Your admin access expires on " +
              new Date(s.expires_at).toLocaleString("en-KE", {
                timeZone: "Africa/Nairobi",
              }) +
              ". Renew from Subscription to continue using admin tools."
            : "Renew your subscription to restore admin tools. You can still sign in and access your billing history.",
        link: "/admin/subscription",
        priority: "urgent",
      });
      sent++;
    });
  }
  return sent;
}
