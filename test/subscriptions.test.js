import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { openDb, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { id, one, hashPassword } from "../src/util.js";
import {
  subscriptionState,
  subscriptionReminders,
  reconcileSubscription,
  ownerPesapal,
} from "../src/services/subscriptions.js";
import { runJobs } from "../src/jobs.js";
let db, app, owner, a, b, student, plan;
const password = "A synthetic staff password";
function provider() {
  return {
    transactions: new Map(),
    submissions: [],
    configured: () => true,
    async submit(attempt, order, user) {
      const tracking = id();
      this.submissions.push({ attempt, order, user });
      this.transactions.set(tracking, {
        merchant_reference: attempt.id,
        amount: order.amount_minor / 100,
        currency: "KES",
        status_code: 0,
        confirmation_code: "SYNTHETIC",
      });
      return {
        merchant_reference: attempt.id,
        order_tracking_id: tracking,
        redirect_url: "https://cybqa.pesapal.com/test/" + tracking,
      };
    },
    async status(tracking) {
      const v = this.transactions.get(tracking);
      if (!v) throw Error("Unknown synthetic provider record");
      return v;
    },
  };
}
const ownerProvider = provider(),
  paperProvider = provider();
async function client(email) {
  const agent = request.agent(app),
    boot = await agent.get("/api/bootstrap");
  const c = { a: agent, csrf: boot.body.csrf };
  if (email) {
    const r = await call(c, "/api/auth/staff", { email, password });
    assert.equal(r.status, 200, r.text);
    c.uid = r.body.user.id;
  }
  return c;
}
async function call(c, url, body = {}, method = "post") {
  const r = await c.a[method](url).set("x-csrf-token", c.csrf).send(body);
  if (r.body.csrf) c.csrf = r.body.csrf;
  return r;
}
async function configure(extra = {}) {
  const r = await call(
    owner,
    "/api/subscriptions/plan",
    {
      enabled: true,
      name: "Platform licence",
      terms:
        "A 30-day admin subscription paid by the administrator through Pesapal.",
      amount_minor: 100000,
      period_days: 30,
      ...extra,
    },
    "put",
  );
  assert.equal(r.status, 200, r.text);
  plan = r.body.plan;
  return plan;
}
async function checkout(c) {
  const r = await call(c, "/api/subscriptions/checkout", {
    plan_version: plan.version,
    accept_terms: true,
    amount_minor: 1,
    period_days: 999,
    admin_id: "forged",
  });
  assert.equal(r.status, 200, r.text);
  const attempt = await one(
    db,
    "SELECT * FROM subscription_attempts WHERE order_id=$1",
    [r.body.order.id],
  );
  return { order: r.body.order, attempt };
}
async function paid(c) {
  const x = await checkout(c);
  ownerProvider.transactions.get(x.attempt.tracking_id).status_code = 1;
  assert.equal(
    (await call(c, "/api/subscriptions/orders/" + x.order.id + "/check"))
      .status,
    200,
  );
  return x;
}
before(async () => {
  db = await openDb({ directory: ":memory:" });
  await migrate(db);
  for (const [email, role, phone] of [
    ["owner@example.test", "super_admin", "+254700100001"],
    ["admin-a@example.test", "admin", "+254700100002"],
    ["admin-b@example.test", "admin", "+254700100003"],
  ])
    await db.query(
      "INSERT INTO users(id,name,email,phone,password_hash,role,permissions) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id(),
        email.split("@")[0],
        email,
        phone,
        await hashPassword(password),
        role,
        JSON.stringify(["resources", "users", "payments", "community"]),
      ],
    );
  app = createApp({
    db,
    files: {
      async get() {
        return Buffer.from("%PDF-SYNTHETIC");
      },
    },
    provider: paperProvider,
    ownerProvider,
    rateLimits: false,
  });
  owner = await client("owner@example.test");
  a = await client("admin-a@example.test");
  b = await client("admin-b@example.test");
  student = await client();
  const s = await call(student, "/api/auth/register", {
    name: "Study User",
    email: "student@example.test",
    phone: "+254700100004",
  });
  student.uid = s.body.user.id;
});
after(async () => {
  await db.close();
});
test("migration starts with subscriptions disabled so existing admins retain access", async () => {
  const r = await a.a.get("/api/subscriptions/me");
  assert.equal(r.body.active, true);
  assert.equal(r.body.status, "not_required");
  assert.equal((await a.a.get("/api/admin/users")).status, 200);
  assert.equal((await request(app).get("/api/subscriptions/me")).status, 403);
});
test("only the super admin sets subscription amount, period and activation", async () => {
  const input = {
    name: "Forged plan",
    terms: "Forged terms for billing",
    enabled: true,
    amount_minor: 1,
    period_days: 1,
  };
  assert.equal(
    (await call(a, "/api/subscriptions/plan", input, "put")).status,
    403,
  );
  assert.equal(
    (await call(student, "/api/subscriptions/plan", input, "put")).status,
    403,
  );
  assert.equal((await a.a.get("/api/subscriptions/manage")).status, 403);
  await configure();
  assert.equal(plan.amount_minor, 100000);
  assert.equal(plan.period_days, 30);
});
test("unpaid admins lose management access but retain renewal, profile, notices and login", async () => {
  for (const endpoint of [
    "/api/admin/users",
    "/api/admin/resources",
    "/api/admin/summary",
    "/api/social/moderation",
  ])
    assert.equal((await a.a.get(endpoint)).status, 402, endpoint);
  assert.equal((await a.a.get("/api/subscriptions/me")).status, 200);
  assert.equal((await a.a.get("/api/account/notifications")).status, 200);
  assert.equal((await a.a.get("/api/account/sessions")).status, 200);
  assert.equal((await owner.a.get("/api/admin/users")).status, 200);
  assert.equal((await student.a.get("/api/account/summary")).status, 200);
  assert.equal((await student.a.get("/api/subscriptions/me")).status, 403);
  const login = await client("admin-a@example.test");
  assert.equal((await login.a.get("/api/subscriptions/me")).status, 200);
});
test("checkout snapshots the owner-set price and uses only the owner payment provider", async () => {
  assert.equal(
    (
      await call(a, "/api/subscriptions/checkout", {
        plan_version: "stale-version",
        accept_terms: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(a, "/api/subscriptions/checkout", {
        plan_version: plan.version,
      })
    ).status,
    400,
  );
  const x = await checkout(a);
  assert.equal(x.order.amount_minor, 100000);
  assert.equal(x.order.period_days, 30);
  assert.equal(ownerProvider.submissions.length, 1);
  assert.equal(paperProvider.submissions.length, 0);
  assert.equal((await a.a.get("/api/admin/users")).status, 402);
  assert.equal(
    (
      await call(a, "/api/subscriptions/checkout", {
        plan_version: plan.version,
        accept_terms: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(b, "/api/subscriptions/orders/" + x.order.id + "/check"))
      .status,
    404,
  );
});
test("verified payment grants one period and one receipt despite duplicate callbacks", async () => {
  const x = await one(
    db,
    "SELECT a.*,o.admin_id FROM subscription_attempts a JOIN subscription_orders o ON o.id=a.order_id WHERE o.admin_id=$1",
    [a.uid],
  );
  ownerProvider.transactions.get(x.tracking_id).status_code = 1;
  for (let i = 0; i < 2; i++) {
    const r = await request(app).post("/api/subscriptions/ipn").send({
      OrderTrackingId: x.tracking_id,
      OrderMerchantReference: x.id,
      status: "COMPLETED",
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status, 200);
  }
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM subscription_periods WHERE order_id=$1",
        [x.order_id],
      )
    ).n,
    1,
  );
  const s = await a.a.get("/api/subscriptions/me");
  assert.equal(s.body.active, true);
  assert.equal(s.body.days_remaining, 30);
  assert.ok(s.body.orders[0].receipt_id);
  assert.equal((await a.a.get("/api/admin/users")).status, 200);
  assert.equal(
    (
      await b.a.get(
        "/api/subscriptions/receipts/" + s.body.orders[0].receipt_id,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await owner.a.get(
        "/api/subscriptions/receipts/" + s.body.orders[0].receipt_id,
      )
    ).status,
    200,
  );
});
test("early renewal extends the existing paid period without losing remaining days", async () => {
  const before = await subscriptionState(db, a.uid),
    x = await paid(a),
    after = await subscriptionState(db, a.uid);
  assert.equal(
    new Date(after.expires_at) - new Date(before.expires_at),
    30 * 86400000,
  );
  const period = await one(
    db,
    "SELECT * FROM subscription_periods WHERE order_id=$1",
    [x.order.id],
  );
  assert.equal(+new Date(period.starts_at), +new Date(before.expires_at));
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM entitlements WHERE user_id=$1",
        [a.uid],
      )
    ).n,
    0,
  );
});
test("fee changes preserve existing grants and already quoted orders", async () => {
  const x = await checkout(b);
  await configure({ amount_minor: 200000, period_days: 60 });
  assert.equal(
    (
      await one(
        db,
        "SELECT amount_minor FROM subscription_orders WHERE id=$1",
        [x.order.id],
      )
    ).amount_minor,
    100000,
  );
  ownerProvider.transactions.get(x.attempt.tracking_id).status_code = 1;
  await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id);
  const g = await one(
    db,
    "SELECT * FROM subscription_periods WHERE order_id=$1",
    [x.order.id],
  );
  assert.equal(new Date(g.ends_at) - new Date(g.starts_at), 30 * 86400000);
});
test("amount, currency and merchant-reference mismatches cannot activate subscriptions", async () => {
  const x = await checkout(b),
    v = ownerProvider.transactions.get(x.attempt.tracking_id),
    original = { ...v };
  for (const [key, value] of [
    ["amount", 1],
    ["currency", "USD"],
    ["merchant_reference", "wrong-reference"],
  ]) {
    Object.assign(v, original, { status_code: 1, [key]: value });
    assert.equal(
      (await call(b, "/api/subscriptions/orders/" + x.order.id + "/check"))
        .status,
      409,
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM subscription_periods WHERE order_id=$1",
          [x.order.id],
        )
      ).n,
      0,
    );
  }
  Object.assign(v, original, { status_code: 1 });
  await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id);
});
test("failed or forged success parameters do not grant access; reversals revoke only their period", async () => {
  const x = await checkout(a),
    v = ownerProvider.transactions.get(x.attempt.tracking_id);
  v.status_code = 2;
  assert.equal(
    await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id),
    "failed",
  );
  assert.equal(
    (
      await request(app).get(
        "/payments/subscription-callback?OrderTrackingId=" +
          x.attempt.tracking_id +
          "&status=COMPLETED",
      )
    ).status,
    302,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM subscription_periods WHERE order_id=$1",
        [x.order.id],
      )
    ).n,
    0,
  );
  v.status_code = 1;
  assert.equal(
    await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id),
    "completed",
  );
  v.status_code = 2;
  assert.equal(
    await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id),
    "completed",
  );
  v.status_code = 3;
  assert.equal(
    await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id),
    "reversed",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT revoked FROM subscription_periods WHERE order_id=$1",
        [x.order.id],
      )
    ).revoked,
    true,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM subscription_periods WHERE admin_id=$1 AND revoked=false",
        [a.uid],
      )
    ).n,
    2,
  );
  v.status_code = 1;
  assert.equal(
    await reconcileSubscription(db, ownerProvider, x.attempt.tracking_id),
    "reversed",
  );
});
test("paper and subscription callback references cannot be mixed", async () => {
  const x = await one(
    db,
    "SELECT tracking_id FROM subscription_attempts LIMIT 1",
  );
  assert.equal(
    (
      await request(app)
        .post("/api/payments/ipn")
        .send({ OrderTrackingId: x.tracking_id })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/subscriptions/ipn")
        .send({ OrderTrackingId: id() })
    ).status,
    404,
  );
});
test("timeouts cannot create another charge and the super admin can recover the reference", async () => {
  const old = ownerProvider.submit;
  let accepted;
  ownerProvider.submit = async function (...args) {
    accepted = await old.apply(this, args);
    throw Error("Synthetic network timeout after acceptance");
  };
  try {
    assert.equal(
      (
        await call(a, "/api/subscriptions/checkout", {
          plan_version: plan.version,
          accept_terms: true,
        })
      ).status,
      500,
    );
  } finally {
    ownerProvider.submit = old;
  }
  const order = await one(
    db,
    "SELECT * FROM subscription_orders WHERE admin_id=$1 AND status='submission_unknown'",
    [a.uid],
  );
  assert.ok(order);
  const count = ownerProvider.submissions.length;
  assert.equal(
    (await call(a, "/api/subscriptions/orders/" + order.id + "/pay")).status,
    409,
  );
  assert.equal(ownerProvider.submissions.length, count);
  assert.equal(
    (
      await call(a, "/api/subscriptions/manage/orders/" + order.id + "/link", {
        tracking_id: accepted.order_tracking_id,
      })
    ).status,
    403,
  );
  ownerProvider.transactions.get(accepted.order_tracking_id).status_code = 1;
  const recovered = await call(
    owner,
    "/api/subscriptions/manage/orders/" + order.id + "/link",
    { tracking_id: accepted.order_tracking_id },
  );
  assert.equal(recovered.status, 200, recovered.text);
  assert.equal(recovered.body.status, "completed");
});
test("expiry enforcement is request-time and disables privileged direct file access", async () => {
  await db.query(
    "UPDATE subscription_periods SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE admin_id=$1",
    [b.uid],
  );
  assert.equal((await b.a.get("/api/admin/users")).status, 402);
  assert.equal((await b.a.get("/api/subscriptions/me")).body.status, "expired");
  await db.query(
    "INSERT INTO courses(id,name) VALUES('sub-course','Subscription test course')",
  );
  await db.query(
    "INSERT INTO units(id,course_id,name,code) VALUES('sub-unit','sub-course','Test Unit','TU')",
  );
  await db.query(
    "INSERT INTO assessment_series(id,name,year) VALUES('sub-series','Test',2026)",
  );
  await db.query(
    "INSERT INTO resources(id,title,course_id,unit_id,series_id,level,type,price_minor,year,status,file_key) VALUES('private-test','Private paper','sub-course','sub-unit','sub-series','Level 5','Notes',100,2026,'published','private-key')",
  );
  assert.equal((await b.a.get("/api/files/private-test")).status, 403);
  const o = id();
  await db.query(
    "INSERT INTO orders(id,user_id,amount_minor,status) VALUES($1,$2,100,'completed')",
    [o, student.uid],
  );
  await db.query(
    "INSERT INTO entitlements(user_id,resource_id,order_id) VALUES($1,'private-test',$2)",
    [student.uid, o],
  );
  assert.equal((await student.a.get("/api/files/private-test")).status, 200);
});
test("renewing after expiry starts a fresh access period and reminders are idempotent", async () => {
  await paid(b);
  assert.equal((await b.a.get("/api/admin/users")).status, 200);
  await db.query(
    "UPDATE subscription_periods SET starts_at=now()-interval '59 days',ends_at=now()+interval '1 day' WHERE admin_id=$1 AND revoked=false",
    [b.uid],
  );
  assert.equal(await subscriptionReminders(db), 1);
  assert.equal(await subscriptionReminders(db), 0);
  await db.query(
    "UPDATE subscription_periods SET starts_at=now()-interval '61 days',ends_at=now()-interval '1 day' WHERE admin_id=$1",
    [b.uid],
  );
  assert.equal(await subscriptionReminders(db), 1);
  assert.equal(await subscriptionReminders(db), 0);
  const notices = await b.a.get("/api/account/notifications");
  assert.ok(notices.body.some((n) => n.title === "Admin subscription expired"));
});
test("disabling subscriptions restores assigned permissions; unavailable owner credentials prevent activation", async () => {
  await configure({ enabled: false });
  assert.equal((await b.a.get("/api/admin/users")).status, 200);
  const original = ownerProvider.configured;
  ownerProvider.configured = () => false;
  try {
    const r = await call(
      owner,
      "/api/subscriptions/plan",
      {
        name: "Plan",
        terms: "Some valid subscription terms",
        enabled: true,
        amount_minor: 1000,
        period_days: 30,
      },
      "put",
    );
    assert.equal(r.status, 400);
    assert.equal(
      (
        await call(a, "/api/subscriptions/checkout", {
          plan_version: plan.version,
          accept_terms: true,
        })
      ).status,
      503,
    );
  } finally {
    ownerProvider.configured = original;
  }
});
test("owner Pesapal configuration never falls back to the paper-sales merchant", async () => {
  const key = process.env.PESAPAL_CONSUMER_KEY,
    secret = process.env.PESAPAL_CONSUMER_SECRET,
    ipn = process.env.PESAPAL_IPN_ID;
  process.env.PESAPAL_CONSUMER_KEY = "paper-only-key";
  process.env.PESAPAL_CONSUMER_SECRET = "paper-only-secret";
  process.env.PESAPAL_IPN_ID = "paper-ipn";
  try {
    const p = ownerPesapal();
    assert.equal(p.configured(), false);
    assert.equal(p.key, "");
    assert.equal(p.ipnPath, "/api/subscriptions/ipn");
    assert.equal(p.callbackPath, "/payments/subscription-callback");
  } finally {
    for (const [name, value] of [
      ["PESAPAL_CONSUMER_KEY", key],
      ["PESAPAL_CONSUMER_SECRET", secret],
      ["PESAPAL_IPN_ID", ipn],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
test("scheduled reconciliation confirms owner payments without a returning browser", async () => {
  await configure();
  const x = await checkout(a);
  ownerProvider.transactions.get(x.attempt.tracking_id).status_code = 1;
  const result = await runJobs(db, paperProvider, { ownerProvider });
  assert.equal(result.subscription_reconciled, 1);
  assert.equal(
    (
      await one(db, "SELECT status FROM subscription_orders WHERE id=$1", [
        x.order.id,
      ])
    ).status,
    "completed",
  );
});
test("subscription dashboard, owner controls and receipts render against real APIs", async () => {
  const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const [c, path] of [
    [a, "/admin/subscription"],
    [owner, "/admin/subscriptions"],
  ]) {
    const dom = new JSDOM(
      '<link rel="icon"><div id="app"></div><div id="toast"></div><dialog id="modal"><div id="modal-body"></div></dialog>',
      { url: "http://localhost:3000" + path },
    );
    const w = dom.window;
    try {
      await new AsyncFunction(
        "document",
        "window",
        "location",
        "fetch",
        "Image",
        "FormData",
        "setTimeout",
        source,
      )(
        w.document,
        w,
        w.location,
        async (url, options = {}) => {
          const r = await c.a[(options.method || "GET").toLowerCase()](url)
            .set(options.headers || {})
            .send(options.body ? JSON.parse(options.body) : undefined);
          return {
            ok: r.status < 400,
            status: r.status,
            json: async () => r.body,
          };
        },
        w.Image,
        w.FormData,
        () => {},
      );
      assert.doesNotMatch(
        w.document.querySelector("#app").textContent,
        /Unable to open this page|Unable to connect/,
      );
      assert.match(w.document.querySelector("h1").textContent, /subscription/i);
      assert.equal(w.document.querySelectorAll(".bottom-nav a").length, 5);
    } finally {
      w.close();
    }
  }
});
