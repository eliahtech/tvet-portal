import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDb, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { id, one, rows, hashPassword, digest } from "../src/util.js";
import { seed } from "../scripts/seed.js";
import { permissions } from "../src/auth.js";
import { inspectPdf } from "../src/services/storage.js";
import { reconcile } from "../src/services/orders.js";
import { runJobs } from "../src/jobs.js";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
let db,
  app,
  admin,
  alice,
  bob,
  base,
  free,
  store = new Map();
const pass = "A strong test password 2026!";
const files = {
  async put(b, ext = "pdf", area = "documents") {
    const k = area + "/" + id() + "." + ext;
    store.set(k, Buffer.from(b));
    return k;
  },
  async get(k) {
    if (!store.has(k)) throw Error("missing file");
    return store.get(k);
  },
  async remove(k) {
    store.delete(k);
  },
};
const provider = {
  transactions: new Map(),
  configured: () => true,
  async submit(a, o, u) {
    const tracking = id();
    this.transactions.set(tracking, {
      merchant_reference: a.id,
      amount: o.amount_minor / 100,
      currency: o.currency,
      status_code: 0,
      confirmation_code: "TEST",
    });
    return {
      order_tracking_id: tracking,
      merchant_reference: a.id,
      redirect_url: "https://cybqa.pesapal.com/test/" + tracking,
    };
  },
  async status(t) {
    if (!this.transactions.has(t)) throw Error("unknown provider reference");
    return this.transactions.get(t);
  },
};
async function browser() {
  const a = request.agent(app);
  const b = await a.get("/api/bootstrap");
  return { a, csrf: b.body.csrf, uid: null };
}
async function post(c, path, body = {}, method = "post") {
  const r = await c.a[method](path).set("x-csrf-token", c.csrf).send(body);
  if (r.body.csrf) c.csrf = r.body.csrf;
  return r;
}
async function student() {
  const c = await browser(),
    n = id().slice(0, 8);
  let r = await post(c, "/api/auth/register", {
    name: "Student " + n,
    email: n + "@example.test",
    phone: "+2547" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
  });
  assert.equal(r.status, 200, r.text);
  c.uid = r.body.user.id;
  c.email = r.body.user.email;
  await post(c, "/api/account/password", { password: pass });
  return c;
}
async function resource({ series, price = 5000 } = {}) {
  const r = {
    ...base,
    id: id(),
    series_id: series || base.series_id,
    price_minor: price,
  };
  const key = await files.put(await files.get(base.file_key));
  await db.query(
    "INSERT INTO resources(id,title,description,course_id,unit_id,series_id,level,body,type,price_minor,year,status,file_key,preview_key,file_size,pages) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    [
      r.id,
      r.title,
      r.description,
      r.course_id,
      r.unit_id,
      r.series_id,
      r.level,
      r.body,
      r.type,
      r.price_minor,
      r.year,
      "published",
      key,
      r.preview_key,
      r.file_size,
      r.pages,
    ],
  );
  return { ...r, file_key: key };
}
async function checkout(c, r) {
  await post(c, "/api/account/cart", { item_id: r.id });
  const response = await post(c, "/api/account/checkout", {
    accept_terms: true,
  });
  assert.equal(response.status, 200, response.text);
  const attempt = await one(
    db,
    "SELECT * FROM payment_attempts WHERE order_id=$1",
    [response.body.order.id],
  );
  return { order: response.body.order, attempt };
}
async function purchase(c, r) {
  const o = await checkout(c, r);
  provider.transactions.get(o.attempt.tracking_id).status_code = 1;
  const x = await post(c, "/api/account/orders/" + o.order.id + "/check");
  assert.equal(x.status, 200, x.text);
  return o;
}
before(async () => {
  db = await openDb({ directory: ":memory:" });
  await migrate(db);
  await seed(db, files);
  base = await one(db, "SELECT * FROM resources WHERE price_minor>0 LIMIT 1");
  free = await one(db, "SELECT * FROM resources WHERE price_minor=0 LIMIT 1");
  app = createApp({ db, files, provider, rateLimits: false });
  const aid = id();
  await db.query(
    "INSERT INTO users(id,name,email,phone,password_hash,role) VALUES($1,'Portal Owner','owner@example.test','+254700000001',$2,'super_admin')",
    [aid, await hashPassword(pass)],
  );
  admin = await browser();
  let r = await post(admin, "/api/auth/staff", {
    email: "owner@example.test",
    password: pass,
  });
  assert.equal(r.status, 200);
  admin.uid = aid;
  alice = await student();
  bob = await student();
});
after(async () => {
  await db.close();
});
test("public catalogue, filters, course and unit search work without login", async () => {
  const c = await request(app).get("/api/catalogue");
  assert.equal(c.status, 200);
  assert.equal(c.body.total, 12);
  assert.equal(
    (await request(app).get("/api/catalogue?q=ICT-CP-01")).body.total,
    2,
  );
  assert.equal(
    (await request(app).get("/api/catalogue?free=true")).body.total,
    6,
  );
  assert.equal(
    (await request(app).get("/api/catalogue?course=ict&level=Level%206")).body
      .total,
    1,
  );
  assert.equal(
    (await request(app).get("/api/catalogue?q=definitely-missing")).body.total,
    0,
  );
});
test("public metadata excludes storage keys and passwords", async () => {
  const r = await request(app).get("/api/resources/" + base.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.file_key, undefined);
  assert.equal(r.body.preview_key, undefined);
  const b = await alice.a.get("/api/bootstrap");
  assert.equal(b.body.user.password_hash, undefined);
});
test("pagination and sort are bounded and SQL injection stays data", async () => {
  assert.equal(
    (await request(app).get("/api/catalogue?page=2")).body.items.length,
    0,
  );
  assert.equal(
    (await request(app).get("/api/catalogue?q='+OR+1=1--&sort=DROP")).body
      .total,
    0,
  );
});
test("three-field registration creates account without verification and password gate protects checkout", async () => {
  const c = await browser();
  const r = await post(c, "/api/auth/register", {
    name: "New User",
    email: "new@example.test",
    phone: "+254700000002",
    role: "super_admin",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, "student");
  assert.equal(r.body.needsPassword, true);
  const p = await post(c, "/api/account/checkout", { accept_terms: true });
  assert.equal(p.status, 403);
});
test("existing contact details never sign in an existing account", async () => {
  const c = await browser();
  assert.equal(
    (
      await post(c, "/api/auth/register", {
        name: "Imposter",
        email: alice.email,
        phone: "+254700000099",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(c, "/api/auth/login", {
        email: alice.email,
        password: "wrong",
      })
    ).status,
    401,
  );
});
test("returning student login works and staff portal rejects student accounts", async () => {
  const c = await browser();
  assert.equal(
    (await post(c, "/api/auth/login", { email: alice.email, password: pass }))
      .status,
    200,
  );
  assert.equal(
    (await post(c, "/api/auth/staff", { email: alice.email, password: pass }))
      .status,
    401,
  );
});
test("CSRF and foreign-origin mutations are rejected", async () => {
  assert.equal(
    (await alice.a.post("/api/account/cart").send({ item_id: base.id })).status,
    403,
  );
  assert.equal(
    (
      await alice.a
        .post("/api/account/cart")
        .set("x-csrf-token", alice.csrf)
        .set("Origin", "https://evil.example")
        .send({ item_id: base.id })
    ).status,
    403,
  );
});
test("students cannot access admin APIs or change their own role", async () => {
  assert.equal((await alice.a.get("/api/admin/users")).status, 403);
  await post(
    alice,
    "/api/account/profile",
    {
      name: "Alice",
      email: alice.email,
      phone: (await one(db, "SELECT phone FROM users WHERE id=$1", [alice.uid]))
        .phone,
      role: "super_admin",
    },
    "put",
  );
  assert.equal(
    (await one(db, "SELECT role FROM users WHERE id=$1", [alice.uid])).role,
    "student",
  );
});
test("contact change requires current password", async () => {
  assert.equal(
    (
      await post(
        alice,
        "/api/account/profile",
        {
          name: "Alice",
          email: "changed@example.test",
          phone: "+254700000005",
        },
        "put",
      )
    ).status,
    403,
  );
});
test("private paid files are inaccessible without purchase while limited previews and free PDFs work", async () => {
  assert.equal((await request(app).get("/api/files/" + base.id)).status, 401);
  assert.equal((await alice.a.get("/api/files/" + base.id)).status, 403);
  const p = await request(app).get("/api/resources/" + base.id + "/preview");
  assert.equal(p.status, 200);
  assert.match(p.headers["content-type"], /pdf/);
  assert.equal((await request(app).get("/api/files/" + free.id)).status, 200);
});
test("server computes checkout prices and pending payment does not grant access", async () => {
  const r = await resource(),
    x = await checkout(alice, r);
  assert.equal(x.order.amount_minor, 5000);
  assert.equal((await alice.a.get("/api/files/" + r.id)).status, 403);
  assert.equal(
    (await one(db, "SELECT status FROM orders WHERE id=$1", [x.order.id]))
      .status,
    "pending",
  );
});
test("successful verified payment creates entitlement and receipt exactly once", async () => {
  const r = await resource(),
    x = await purchase(alice, r);
  await Promise.all([
    reconcile(db, provider, x.attempt.tracking_id),
    reconcile(db, provider, x.attempt.tracking_id),
  ]);
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM entitlements WHERE order_id=$1",
        [x.order.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await one(db, "SELECT count(*)::int n FROM receipts WHERE order_id=$1", [
        x.order.id,
      ])
    ).n,
    1,
  );
  assert.equal((await alice.a.get("/api/files/" + r.id)).status, 200);
  assert.equal((await bob.a.get("/api/files/" + r.id)).status, 403);
  const receipt = await one(db, "SELECT id FROM receipts WHERE order_id=$1", [
    x.order.id,
  ]);
  assert.equal(
    (await bob.a.get("/api/account/receipts/" + receipt.id)).status,
    404,
  );
});
test("forged callback parameters cannot grant access", async () => {
  const r = await resource(),
    x = await checkout(bob, r);
  const response = await request(app).get(
    "/payments/callback?OrderTrackingId=" +
      x.attempt.tracking_id +
      "&status=COMPLETED",
  );
  assert.equal(response.status, 302);
  assert.equal((await bob.a.get("/api/files/" + r.id)).status, 403);
});
test("mismatched provider amount, currency and merchant reference reject fulfillment", async () => {
  for (const [key, value] of [
    ["amount", 1],
    ["currency", "USD"],
    ["merchant_reference", "other-order"],
  ]) {
    const r = await resource(),
      x = await checkout(bob, r),
      status = provider.transactions.get(x.attempt.tracking_id);
    Object.assign(status, { status_code: 1, [key]: value });
    assert.equal(
      (await post(bob, "/api/account/orders/" + x.order.id + "/check")).status,
      409,
    );
    assert.equal((await bob.a.get("/api/files/" + r.id)).status, 403);
  }
});
test("failed, delayed and reversed provider events have correct access behavior", async () => {
  const r = await resource(),
    x = await checkout(alice, r),
    s = provider.transactions.get(x.attempt.tracking_id);
  s.status_code = 2;
  assert.equal(await reconcile(db, provider, x.attempt.tracking_id), "failed");
  s.status_code = 1;
  assert.equal(
    await reconcile(db, provider, x.attempt.tracking_id),
    "completed",
  );
  s.status_code = 2;
  assert.equal(
    await reconcile(db, provider, x.attempt.tracking_id),
    "completed",
  );
  s.status_code = 3;
  assert.equal(
    await reconcile(db, provider, x.attempt.tracking_id),
    "reversed",
  );
  s.status_code = 1;
  assert.equal(
    await reconcile(db, provider, x.attempt.tracking_id),
    "reversed",
  );
  assert.equal((await alice.a.get("/api/files/" + r.id)).status, 403);
});
test("duplicate purchase of an owned paper is rejected", async () => {
  const r = await resource();
  await purchase(alice, r);
  await post(alice, "/api/account/cart", { item_id: r.id });
  assert.equal(
    (await post(alice, "/api/account/checkout", { accept_terms: true })).status,
    409,
  );
  await post(alice, "/api/account/cart/" + r.id, {}, "delete");
});
test("the same unresolved order cannot be charged through duplicate checkout", async () => {
  const r = await resource(),
    x = await checkout(bob, r);
  await post(bob, "/api/account/cart", { item_id: r.id });
  assert.equal(
    (await post(bob, "/api/account/checkout", { accept_terms: true })).status,
    409,
  );
  const resumed = await post(bob, "/api/account/orders/" + x.order.id + "/pay");
  assert.equal(resumed.status, 200);
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM payment_attempts WHERE order_id=$1",
        [x.order.id],
      )
    ).n,
    1,
  );
  await post(bob, "/api/account/cart/" + r.id, {}, "delete");
});
test("free resource acquisition needs no payment provider and appears in library", async () => {
  await post(bob, "/api/account/cart", { item_id: free.id });
  const r = await post(bob, "/api/account/checkout", { accept_terms: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.free, true);
  assert.ok(
    await one(
      db,
      "SELECT 1 FROM entitlements WHERE user_id=$1 AND resource_id=$2",
      [bob.uid, free.id],
    ),
  );
});
test("bundle allocation totals exactly and overlapping cart items are blocked", async () => {
  const a = await resource(),
    b = await resource();
  let r = await post(admin, "/api/admin/bundles", {
    title: "Unit bundle",
    description: "Test",
    price_minor: 7501,
    resource_ids: [a.id, b.id],
  });
  assert.equal(r.status, 200, r.text);
  const bundle = await one(
    db,
    "SELECT id FROM bundles WHERE title='Unit bundle'",
  );
  await post(alice, "/api/account/cart", {
    item_id: bundle.id,
    kind: "bundle",
  });
  await post(alice, "/api/account/cart", { item_id: a.id });
  assert.equal(
    (await post(alice, "/api/account/checkout", { accept_terms: true })).status,
    409,
  );
  await post(alice, "/api/account/cart/" + a.id, {}, "delete");
  r = await post(alice, "/api/account/checkout", { accept_terms: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.order.amount_minor, 7501);
  assert.equal(
    (
      await one(
        db,
        "SELECT sum(price_minor)::int n FROM order_items WHERE order_id=$1",
        [r.body.order.id],
      )
    ).n,
    7501,
  );
});
test("profile, library, wishlist, cart, notifications and requests APIs render valid data", async () => {
  for (const endpoint of [
    "summary",
    "papers",
    "wishlist",
    "cart",
    "notifications",
    "requests",
    "tickets",
    "orders",
    "sessions",
  ]) {
    const r = await alice.a.get("/api/account/" + endpoint);
    assert.equal(r.status, 200, endpoint + ": " + r.text);
  }
  assert.equal(
    (await post(alice, "/api/account/wishlist/" + base.id)).status,
    200,
  );
  assert.equal(
    (
      await post(alice, "/api/account/requests", {
        unit: "Networking fundamentals",
        details: "Need revision notes for this unit",
        course_id: "ict",
      })
    ).status,
    200,
  );
});
test("support tickets enforce ownership and staff replies notify the owner", async () => {
  const r = await post(alice, "/api/account/tickets", {
    subject: "Document question",
    message: "Please explain the document type",
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await post(bob, "/api/account/tickets/" + r.body.id + "/reply", {
        message: "Intrusion",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(admin, "/api/admin/tickets/" + r.body.id, {
        message: "This is a revision paper",
        status: "closed",
      })
    ).status,
    200,
  );
  const tickets = await alice.a.get("/api/account/tickets");
  assert.ok(
    tickets.body.some((t) => t.id === r.body.id && t.messages.length === 2),
  );
});
test("notification targeting and per-user read state remain private", async () => {
  const r = await post(admin, "/api/admin/notifications", {
    target: "users",
    user_ids: [alice.uid],
    title: "Alice only",
    message: "Private student notice",
  });
  assert.equal(r.status, 200);
  const ns = await alice.a.get("/api/account/notifications"),
    n = ns.body.find((n) => n.title === "Alice only");
  assert.ok(n);
  assert.ok(
    !(await bob.a.get("/api/account/notifications")).body.some(
      (x) => x.id === n.id,
    ),
  );
  await post(bob, "/api/account/notifications/read", { id: n.id });
  assert.equal(
    (
      await one(
        db,
        "SELECT read_at FROM notification_recipients WHERE notification_id=$1 AND user_id=$2",
        [n.id, alice.uid],
      )
    ).read_at,
    null,
  );
  await post(alice, "/api/account/notifications/read", { id: n.id });
  assert.ok(
    (
      await one(
        db,
        "SELECT read_at FROM notification_recipients WHERE notification_id=$1 AND user_id=$2",
        [n.id, alice.uid],
      )
    ).read_at,
  );
});
test("admins need explicit permissions and only super admin can create staff", async () => {
  const uid = id();
  await db.query(
    "INSERT INTO users(id,name,email,phone,password_hash,role,permissions) VALUES($1,'Limited Admin','limited@example.test','+254700000003',$2,'admin','[\"support\"]')",
    [uid, await hashPassword(pass)],
  );
  const c = await browser();
  await post(c, "/api/auth/staff", {
    email: "limited@example.test",
    password: pass,
  });
  assert.equal((await c.a.get("/api/admin/tickets")).status, 200);
  assert.equal((await c.a.get("/api/admin/payments")).status, 403);
  assert.equal(
    (await post(c, "/api/admin/staff", { name: "Bad" })).status,
    403,
  );
});
test("super admin can create admin and the last super admin cannot be suspended", async () => {
  assert.equal(
    (
      await post(admin, "/api/admin/staff", {
        name: "New Admin",
        email: "newadmin@example.test",
        phone: "+254700000004",
        password: pass,
        permissions: ["resources", "made_up"],
      })
    ).status,
    200,
  );
  const u = await one(
    db,
    "SELECT * FROM users WHERE email='newadmin@example.test'",
  );
  assert.deepEqual(u.permissions, ["resources"]);
  assert.equal(
    (
      await post(
        admin,
        "/api/admin/staff/" + admin.uid,
        { status: "suspended" },
        "patch",
      )
    ).status,
    409,
  );
});
test("suspension revokes sessions and preserves order history; reactivation allows login", async () => {
  const c = await student();
  const r = await resource();
  await purchase(c, r);
  const update = {
    name: "Paused Student",
    email: c.email,
    phone: (await one(db, "SELECT phone FROM users WHERE id=$1", [c.uid]))
      .phone,
    status: "suspended",
    reason: "Support review",
  };
  assert.equal(
    (await post(admin, "/api/admin/users/" + c.uid, update, "patch")).status,
    200,
  );
  assert.equal((await c.a.get("/api/account/orders")).status, 401);
  assert.ok(await one(db, "SELECT 1 FROM orders WHERE user_id=$1", [c.uid]));
  await post(
    admin,
    "/api/admin/users/" + c.uid,
    { ...update, status: "active" },
    "patch",
  );
  const d = await browser();
  assert.equal(
    (await post(d, "/api/auth/login", { email: c.email, password: pass }))
      .status,
    200,
  );
});
test("resource upload validates PDF, generates preview and replacement preserves purchases", async () => {
  const fake = await admin.a
    .post("/api/admin/resources")
    .set("x-csrf-token", admin.csrf)
    .field("title", "Bad PDF")
    .field("course_id", "ict")
    .field("unit_id", "ict-unit")
    .field("series_id", "demo-series")
    .field("level", "Level 6")
    .field("body", "Institution")
    .field("type", "Model Paper")
    .field("price_minor", "100")
    .field("year", "2026")
    .attach("files", Buffer.from("not a pdf"), "bad.pdf");
  assert.equal(fake.status, 200);
  assert.equal(fake.body.results[0].success, false);
  const r = await resource();
  await purchase(bob, r);
  const replaced = await admin.a
    .post("/api/admin/resources/" + r.id + "/replace")
    .set("x-csrf-token", admin.csrf)
    .attach("file", await files.get(base.file_key), "replacement.pdf");
  assert.equal(replaced.status, 200, replaced.text);
  assert.equal((await bob.a.get("/api/files/" + r.id)).status, 200);
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM resource_versions WHERE resource_id=$1",
        [r.id],
      )
    ).n,
    1,
  );
});
test("PDF validation rejects invalid or encrypted content and preview is separately generated", async () => {
  await assert.rejects(inspectPdf(Buffer.from("script")));
  const p = await inspectPdf(await files.get(base.file_key));
  assert.equal(p.pages, 3);
  assert.notDeepEqual(p.bytes, p.preview);
});
test("closing a series removes public listings but preserves purchased access", async () => {
  const sid = id();
  await db.query(
    "INSERT INTO assessment_series(id,name,year) VALUES($1,$2,2026)",
    [sid, "Closure test"],
  );
  const r = await resource({ series: sid });
  await purchase(alice, r);
  assert.equal(
    (await post(admin, "/api/admin/series/" + sid + "/close")).status,
    200,
  );
  assert.equal((await request(app).get("/api/resources/" + r.id)).status, 404);
  assert.equal((await alice.a.get("/api/files/" + r.id)).status, 200);
  assert.equal(
    (await post(admin, "/api/admin/series/" + sid + "/reopen")).status,
    200,
  );
});
test("deletion requires notice, sends buyer notices, blocks premature execution and preserves financial records", async () => {
  const sid = id(),
    name = "Deletion test";
  await db.query(
    "INSERT INTO assessment_series(id,name,year) VALUES($1,$2,2026)",
    [sid, name],
  );
  const r = await resource({ series: sid }),
    o = await purchase(alice, r);
  const after = new Date(Date.now() + 8 * 86400000).toISOString();
  assert.equal(
    (
      await post(admin, "/api/admin/series/" + sid + "/deletion", {
        reason: "Series completed",
        execute_after: after,
        confirmation: "wrong",
      })
    ).status,
    400,
  );
  const job = await post(admin, "/api/admin/series/" + sid + "/deletion", {
    reason: "Series completed",
    execute_after: after,
    confirmation: name,
  });
  assert.equal(job.status, 200, job.text);
  assert.equal(job.body.buyers, 1);
  assert.equal(
    (await alice.a.get("/api/account/papers")).body.notices.some(
      (n) => n.series_id === sid,
    ),
    true,
  );
  assert.equal(
    (
      await post(admin, "/api/admin/deletions/" + job.body.id + "/execute", {
        confirmation: name,
      })
    ).status,
    409,
  );
  await db.query(
    "UPDATE deletion_jobs SET execute_after=now()-interval '1 day' WHERE id=$1",
    [job.body.id],
  );
  assert.equal(
    (
      await post(admin, "/api/admin/deletions/" + job.body.id + "/execute", {
        confirmation: name,
      })
    ).status,
    200,
  );
  assert.equal(store.has(r.file_key), false);
  assert.equal((await alice.a.get("/api/files/" + r.id)).status, 404);
  assert.ok(
    await one(db, "SELECT 1 FROM receipts WHERE order_id=$1", [o.order.id]),
  );
  assert.ok(
    await one(db, "SELECT 1 FROM entitlements WHERE resource_id=$1", [r.id]),
  );
});
test("scheduled deletion cancellation preserves access and notifies buyers", async () => {
  const sid = id(),
    name = "Cancelled removal";
  await db.query(
    "INSERT INTO assessment_series(id,name,year) VALUES($1,$2,2026)",
    [sid, name],
  );
  const r = await resource({ series: sid });
  await purchase(bob, r);
  const j = await post(admin, "/api/admin/series/" + sid + "/deletion", {
    reason: "Series completed",
    execute_after: new Date(Date.now() + 8 * 86400000).toISOString(),
    confirmation: name,
  });
  assert.equal(
    (await post(admin, "/api/admin/deletions/" + j.body.id + "/cancel")).status,
    200,
  );
  assert.equal((await bob.a.get("/api/files/" + r.id)).status, 200);
});
test("unresolved paid orders prevent deletion scheduling", async () => {
  const sid = id(),
    name = "Pending payment series";
  await db.query(
    "INSERT INTO assessment_series(id,name,year) VALUES($1,$2,2026)",
    [sid, name],
  );
  const r = await resource({ series: sid });
  await checkout(bob, r);
  assert.equal(
    (
      await post(admin, "/api/admin/series/" + sid + "/deletion", {
        reason: "Series completed",
        execute_after: new Date(Date.now() + 8 * 86400000).toISOString(),
        confirmation: name,
      })
    ).status,
    409,
  );
});
test("staff pages, exports, reports and taxonomy APIs return successful responses", async () => {
  for (const endpoint of [
    "summary",
    "resources",
    "catalogue",
    "users",
    "payments",
    "requests",
    "tickets",
    "bundles",
    "reports",
    "staff",
    "settings",
    "audit",
    "deletions",
    "notification-options",
    "request-resources",
  ]) {
    const r = await admin.a.get("/api/admin/" + endpoint);
    assert.equal(r.status, 200, endpoint + ": " + r.text);
  }
  const csv = await admin.a.get("/api/admin/reports.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /csv/);
});
test("password recovery uses a private outbox and single-use tokens that revoke sessions", async () => {
  const c = await student();
  const r = await post(c, "/api/auth/recover", { email: c.email });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, undefined);
  const j = await one(
    db,
    "SELECT * FROM jobs WHERE kind='password_reset' AND payload->>'user_id'=$1 ORDER BY created_at DESC LIMIT 1",
    [c.uid],
  );
  const raw = new URL(j.payload.url).searchParams.get("token");
  const hash = await one(
    db,
    "SELECT id FROM password_resets WHERE user_id=$1",
    [c.uid],
  );
  assert.equal(hash.id, digest(raw));
  let sent = false;
  const originalFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = "portal@example.test";
  await runJobs(
    db,
    { configured: () => false },
    {
      mailer: {
        async sendMail() {
          sent = true;
        },
      },
    },
  );
  process.env.MAIL_FROM = originalFrom || "";
  assert.equal(sent, true);
  const d = await browser();
  assert.equal(
    (await post(d, "/api/auth/reset", { token: raw, password: pass + "new" }))
      .status,
    200,
  );
  assert.equal(
    (await post(d, "/api/auth/reset", { token: raw, password: pass + "new" }))
      .status,
    400,
  );
  assert.equal((await c.a.get("/api/account/orders")).status, 401);
});
test("SEO endpoints, security headers, health and public route shells work", async () => {
  for (const url of [
    "/",
    "/resources",
    "/courses",
    "/register",
    "/staff/login",
    "/robots.txt",
    "/sitemap.xml",
    "/health",
    "/ready",
    "/viewer?id=" + base.id,
  ])
    assert.equal((await request(app).get(url)).status, 200, url);
  const h = await request(app).get("/");
  assert.match(h.headers["content-security-policy"], /script-src 'self'/);
  assert.equal((await request(app).get("/unknown-page")).status, 404);
  assert.equal(
    (await alice.a.get("/api/account/orders")).headers["x-robots-tag"],
    "noindex, nofollow",
  );
});
test("ambiguous payment submissions cannot silently create a second charge", async () => {
  const r = await resource();
  await post(alice, "/api/account/cart", { item_id: r.id });
  const old = provider.submit;
  provider.submit = async () => {
    throw Error("network timeout");
  };
  let result;
  try {
    result = await post(alice, "/api/account/checkout", { accept_terms: true });
    assert.equal(result.status, 500);
  } finally {
    provider.submit = old;
  }
  const order = await one(
    db,
    "SELECT o.* FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.resource_id=$1",
    [r.id],
  );
  assert.equal(
    (await post(alice, "/api/account/orders/" + order.id + "/pay")).status,
    409,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM payment_attempts WHERE order_id=$1",
        [order.id],
      )
    ).n,
    1,
  );
});
test("notifications cannot be authored by students and branding uploads require super admin", async () => {
  assert.equal(
    (
      await post(alice, "/api/admin/notifications", {
        target: "all",
        title: "Fake notice",
        message: "Not allowed",
      })
    ).status,
    403,
  );
  const response = await bob.a
    .post("/api/admin/branding/logo")
    .set("x-csrf-token", bob.csrf)
    .attach("file", Buffer.from("bad image"), "logo.png");
  assert.equal(response.status, 403);
});
test("rasterized preview PDF contains no hidden original page text", async () => {
  const pdf = await inspectPdf(await files.get(base.file_key));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf.preview),
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise,
      content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((i) => i.str || "").join(" ");
    assert.doesNotMatch(
      text,
      /Practice prompts|Define the key|original sample content/,
    );
    assert.match(text, /LIMITED PREVIEW/);
  } finally {
    await task.destroy();
  }
});
test("all public, student and admin screens render against real API responses in a DOM harness", async () => {
  const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const routes = [
    "/",
    "/resources",
    "/courses",
    "/free",
    "/bundles",
    "/paper/" + base.id,
    "/about",
    "/contact",
    "/faq",
    "/privacy",
    "/terms",
    "/refunds",
    "/access-policy",
    "/login",
    "/register",
    "/reset",
    "/staff/login",
    "/account",
    "/account/papers",
    "/account/wishlist",
    "/account/cart",
    "/account/orders",
    "/account/notifications",
    "/account/requests",
    "/account/support",
    "/account/profile",
    "/admin",
    "/admin/resources",
    "/admin/upload",
    "/admin/catalogue",
    "/admin/series",
    "/admin/bundles",
    "/admin/users",
    "/admin/payments",
    "/admin/requests",
    "/admin/support",
    "/admin/notifications",
    "/admin/reports",
    "/admin/deletions",
    "/admin/staff",
    "/admin/settings",
    "/admin/audit",
  ];
  for (const route of routes) {
    const client = route.startsWith("/admin") ? admin : alice;
    const dom = new JSDOM(
      '<link rel="icon"><div id="app"></div><div id="toast"></div><dialog id="modal"><div id="modal-body"></div></dialog>',
      { url: "http://localhost:3000" + route },
    );
    const window = dom.window;
    const fetcher = async (url, options = {}) => {
      const r = await client.a[(options.method || "GET").toLowerCase()](url)
        .set(options.headers || {})
        .send(options.body ? JSON.parse(options.body) : undefined);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    };
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
        window.document,
        window,
        window.location,
        fetcher,
        window.Image,
        window.FormData,
        () => {},
      );
      assert.ok(window.document.querySelector("h1"), route);
      assert.doesNotMatch(
        window.document.querySelector("#app").textContent,
        /Unable to open this page|Something went wrong|Unable to connect/,
        route,
      );
    } finally {
      window.close();
    }
  }
});
test("IPN handling verifies provider status and is idempotent without a browser session", async () => {
  const r = await resource(),
    x = await checkout(bob, r);
  provider.transactions.get(x.attempt.tracking_id).status_code = 1;
  for (let i = 0; i < 2; i++) {
    const response = await request(app).post("/api/payments/ipn").send({
      OrderTrackingId: x.attempt.tracking_id,
      OrderMerchantReference: x.attempt.id,
      OrderNotificationType: "IPNCHANGE",
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.status, 200);
    assert.equal(response.body.orderTrackingId, x.attempt.tracking_id);
  }
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM entitlements WHERE order_id=$1",
        [x.order.id],
      )
    ).n,
    1,
  );
});
test("production authentication rate limit is active by default", async () => {
  const limited = createApp({ db, files, provider });
  const agent = request.agent(limited),
    boot = await agent.get("/api/bootstrap");
  let last;
  for (let i = 0; i < 31; i++)
    last = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", boot.body.csrf)
      .send({ email: "unknown@example.test", password: "invalid" });
  assert.equal(last.status, 429);
});
