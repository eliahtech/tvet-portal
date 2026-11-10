import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { publicRoutes } from "./routes-public.js";
import { accountRoutes } from "./routes-account.js";
import { adminRoutes } from "./routes-admin.js";
import { socialRoutes } from "./routes-social.js";
import { AIClient } from "./services/ai.js";
import {
  subscriptionState,
  ownerPesapal,
  reconcileSubscription,
} from "./services/subscriptions.js";
import { subscriptionRoutes } from "./routes-subscriptions.js";
import {
  authMiddleware,
  csrf,
  newSession,
  register,
  login,
  requireUser,
  text,
  password,
  has,
} from "./auth.js";
import {
  id,
  one,
  rows,
  fail,
  publicUser,
  token,
  digest,
  hashPassword,
  audit,
} from "./util.js";
import { reconcile } from "./services/orders.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const htmlEscape = (x) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createApp({
  db,
  files,
  provider,
  ai = new AIClient(),
  ownerProvider = ownerPesapal(),
  rateLimits = true,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(
    express.json({ limit: "100kb" }),
    express.urlencoded({ extended: false, limit: "100kb" }),
    cookieParser(),
  );
  app.use(
    "/vendor/bootstrap",
    express.static(path.join(root, "node_modules/bootstrap/dist")),
  );
  app.use(
    "/vendor/icons",
    express.static(path.join(root, "node_modules/bootstrap-icons/font")),
  );
  app.use(
    "/vendor/pdfjs-fonts",
    express.static(path.join(root, "node_modules/pdfjs-dist/standard_fonts")),
  );
  app.use(
    "/vendor/pdfjs-cmaps",
    express.static(path.join(root, "node_modules/pdfjs-dist/cmaps")),
  );
  app.use(
    "/vendor/pdfjs-wasm",
    express.static(path.join(root, "node_modules/pdfjs-dist/wasm")),
  );
  app.use(
    "/vendor/pdfjs",
    express.static(path.join(root, "node_modules/pdfjs-dist/build")),
  );
  app.use(
    "/assets",
    express.static(path.join(root, "public"), { maxAge: "1h" }),
  );
  app.get("/health", (_, res) =>
    res.json({ status: "ok", service: "tvet-portal" }),
  );
  app.get("/ready", async (_, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ready" });
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      skip: () => !rateLimits,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Try again shortly." },
    }),
  );
  app.use(authMiddleware(db));
  app.use(async (req, res, next) => {
    if (req.user?.role === "admin") {
      req.subscription = await subscriptionState(db, req.user.id);
      req.user.subscription_blocked = !req.subscription.active;
    }
    next();
  });
  app.use((req, res, next) => {
    if (/^\/(api|account|admin|staff|payments|viewer)/.test(req.path))
      res.set({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      });
    next();
  });
  app.use(csrf);
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    skip: () => !rateLimits,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many account attempts. Try again later." },
  });
  app.get("/api/bootstrap", async (req, res) => {
    if (!req.csrf) await newSession(db, req, res);
    const settings = Object.fromEntries(
      (
        await rows(
          db,
          "SELECT * FROM settings WHERE key IN ('public','policy')",
        )
      ).map((r) => [r.key, r.value]),
    );
    settings.public.has_logo = !!(await one(
      db,
      "SELECT 1 FROM settings WHERE key='branding_logo'",
    ));
    settings.public.has_favicon = !!(await one(
      db,
      "SELECT 1 FROM settings WHERE key='branding_favicon'",
    ));
    const unread = req.user
      ? (
          await one(
            db,
            "SELECT count(*)::int AS n FROM notification_recipients WHERE user_id=$1 AND read_at IS NULL",
            [req.user.id],
          )
        ).n
      : 0;
    res.json({
      user: publicUser(req.user),
      csrf: req.csrf,
      needsPassword: !!req.user && !req.user.password_hash,
      unread,
      settings,
      local: db.local,
      paymentsConfigured: provider.configured(),
      subscription: req.subscription || null,
      onboarding: {
        status: req.user?.tour_status || "pending",
        step: req.user?.tour_step || 0,
        eligible:
          req.user?.role === "student" &&
          !!req.user?.profile_completed_at &&
          !!req.user?.password_hash,
      },
    });
  });
  app.get("/api/branding/:kind", async (req, res) => {
    if (!["logo", "favicon"].includes(req.params.kind))
      fail(404, "Image not found");
    const r = await one(db, "SELECT value FROM settings WHERE key=$1", [
      "branding_" + req.params.kind,
    ]);
    if (!r) return res.sendFile(path.join(root, "public/favicon.svg"));
    res.type("png").send(await files.get(r.value.key));
  });
  app.post("/api/auth/register", authLimit, (req, res) =>
    register(db, req, res),
  );
  app.post("/api/auth/login", authLimit, (req, res) =>
    login(db, req, res, false),
  );
  app.post("/api/auth/staff", authLimit, (req, res) =>
    login(db, req, res, true),
  );
  app.post("/api/auth/logout", async (req, res) => {
    if (req.sessionId)
      await db.query("DELETE FROM sessions WHERE id=$1", [req.sessionId]);
    res.clearCookie("tvet_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/auth/recover", authLimit, async (req, res) => {
    const email = text(req.body.email, 3, 254).toLowerCase();
    const u = await one(
      db,
      "SELECT * FROM users WHERE email=$1 AND status='active'",
      [email],
    );
    if (u) {
      const raw = token(),
        key = digest(raw);
      await db.tx(async (t) => {
        await t.query(
          "INSERT INTO password_resets(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
          [key, u.id],
        );
        await t.query(
          "INSERT INTO jobs(id,kind,payload) VALUES($1,'password_reset',$2)",
          [
            id(),
            JSON.stringify({
              user_id: u.id,
              reset_id: key,
              url:
                (process.env.APP_URL || "http://localhost:3000") +
                "/reset?token=" +
                raw,
            }),
          ],
        );
      });
    }
    res.json({
      message:
        "If an active account exists, a recovery email will be sent. If no email arrives, contact Support.",
    });
  });
  app.post("/api/auth/reset", authLimit, async (req, res) => {
    const raw = text(req.body.token, 64, 64),
      hash = await hashPassword(password(req.body.password));
    await db.tx(async (t) => {
      const r = await one(
        t,
        "SELECT * FROM password_resets WHERE id=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [digest(raw)],
      );
      if (!r) fail(400, "Recovery link is invalid or expired");
      await t.query(
        "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [r.user_id],
      );
      await t.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        r.user_id,
        hash,
      ]);
      await t.query("DELETE FROM sessions WHERE user_id=$1", [r.user_id]);
      await audit(t, r.user_id, "password.recovered", r.user_id);
    });
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
      files: 20,
      fields: 30,
    },
  });
  const ctx = { db, files, provider, upload };
  app.use("/api", publicRoutes(ctx));
  app.use("/api/account", accountRoutes(ctx));
  app.use("/api/social", socialRoutes({ db, ai }));
  app.use("/api/admin", adminRoutes(ctx));
  app.use("/api/subscriptions", subscriptionRoutes({ db, ownerProvider }));
  app.get("/api/files/:id", async (req, res) => {
    const r = await one(
      db,
      "SELECT r.*,s.status AS series_status FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.id=$1",
      [req.params.id],
    );
    if (!r?.file_key || r.status === "deleted")
      fail(404, "Document is unavailable");
    const free =
      r.price_minor === 0 &&
      r.status === "published" &&
      r.series_status === "open";
    const allowed =
      free ||
      has(req.user, "resources") ||
      (req.user &&
        (await one(
          db,
          "SELECT 1 FROM entitlements WHERE user_id=$1 AND resource_id=$2 AND state='active'",
          [req.user.id, r.id],
        )));
    if (!allowed)
      fail(
        req.user ? 403 : 401,
        "Sign in with the account that purchased this paper",
      );
    const running = await one(
      db,
      "SELECT 1 FROM deletion_jobs j JOIN deletion_resources d ON d.job_id=j.id WHERE d.resource_id=$1 AND j.status='running'",
      [r.id],
    );
    if (running) fail(410, "This document is being permanently removed");
    const bytes = await files.get(r.file_key);
    if (req.user)
      await db.query(
        "INSERT INTO download_logs(id,user_id,resource_id) VALUES($1,$2,$3)",
        [id(), req.user.id, r.id],
      );
    res
      .type("pdf")
      .set({
        "Cache-Control": "private,no-store",
        "Content-Disposition":
          (req.query.download === "1" ? "attachment" : "inline") +
          '; filename="' +
          r.title.replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 100) +
          '.pdf"',
      })
      .send(bytes);
  });
  app.all("/api/payments/ipn", async (req, res) => {
    const p = req.method === "POST" ? req.body : req.query;
    const tracking = text(p.OrderTrackingId, 10, 100);
    await reconcile(db, provider, tracking);
    res.json({
      orderNotificationType: "IPNCHANGE",
      orderTrackingId: tracking,
      orderMerchantReference: p.OrderMerchantReference,
      status: 200,
    });
  });
  app.get("/payments/callback", async (req, res) => {
    if (req.query.OrderTrackingId)
      await reconcile(db, provider, text(req.query.OrderTrackingId, 10, 100));
    res.redirect("/account/orders?returned=1");
  });
  app.get("/payments/subscription-callback", async (req, res) => {
    if (req.query.OrderTrackingId)
      await reconcileSubscription(
        db,
        ownerProvider,
        text(req.query.OrderTrackingId, 10, 100),
      );
    res.redirect("/admin/subscription?returned=1");
  });
  app.get("/robots.txt", (_, res) =>
    res
      .type("text")
      .send(
        "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account/\nDisallow: /admin/\nDisallow: /staff/\nDisallow: /payments/\nDisallow: /viewer\nDisallow: /reset\nSitemap: " +
          (process.env.APP_URL || "http://localhost:3000") +
          "/sitemap.xml",
      ),
  );
  app.get("/sitemap.xml", async (_, res) => {
    const base = process.env.APP_URL || "http://localhost:3000",
      items = await rows(
        db,
        "SELECT r.id FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.status='published' AND s.status='open'",
      );
    res
      .type("xml")
      .send(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          [
            "/",
            "/resources",
            "/courses",
            "/free",
            "/about",
            "/contact",
            "/faq",
            ...items.map((r) => "/paper/" + r.id),
          ]
            .map((p) => "<url><loc>" + htmlEscape(base + p) + "</loc></url>")
            .join("") +
          "</urlset>",
      );
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.get("/viewer", async (req, res) =>
    res.sendFile(path.join(root, "public/viewer.html")),
  );
  app.get(/.*/, async (req, res) => {
    const valid =
      /^\/(?:$|resources$|courses$|free$|bundles$|about$|contact$|faq$|privacy$|terms$|refunds$|access-policy$|register$|login$|reset$|paper\/[a-z0-9-]+$|course\/[a-z0-9-]+$|account(?:\/[a-z-]+)?$|admin(?:\/[a-z-]+)?$|staff\/login$)/.test(
        req.path,
      );
    if (!valid)
      return res
        .status(404)
        .type("html")
        .send('<h1>Page not found</h1><a href="/">Return home</a>');
    const settings = (
      await one(db, "SELECT value FROM settings WHERE key='public'")
    ).value;
    let title = settings.name,
      description =
        "Find TVET past papers, revision resources and notes by course and unit. Browse openly and keep purchased papers in your account.";
    if (req.path.startsWith("/paper/")) {
      const r = await one(
        db,
        "SELECT r.title,r.description FROM resources r JOIN assessment_series s ON s.id=r.series_id WHERE r.id=$1 AND r.status='published' AND s.status='open'",
        [req.path.split("/")[2]],
      );
      if (r) {
        title = r.title + " | " + settings.name;
        description = r.description.slice(0, 160) || description;
      }
    }
    const canonical =
      (process.env.APP_URL || "http://localhost:3000") + req.path;
    let html = await readFile(path.join(root, "public/index.html"), "utf8");
    html = html
      .replaceAll("__TITLE__", htmlEscape(title))
      .replaceAll("__DESCRIPTION__", htmlEscape(description))
      .replaceAll("__CANONICAL__", htmlEscape(canonical));
    res.type("html").send(html);
  });
  app.use((error, req, res, next) => {
    let status = error.status || 500,
      message = error.status
        ? error.message
        : "Something went wrong. Please retry or contact Support.";
    if (error.code === "23505") {
      status = 409;
      message = "An account or record with these details already exists.";
    }
    if (error.code === "23503") {
      status = 400;
      message = "A selected related record does not exist.";
    }
    if (error instanceof multer.MulterError) {
      status = 400;
      message = "Upload exceeds the configured size or file count limit.";
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          method: req.method,
          path: req.path,
          status,
          code: error.code || error.name,
        }),
      );
    if (req.path.startsWith("/api"))
      res.status(status).json({
        error: message,
        ...(error.order_id ? { order_id: error.order_id } : {}),
      });
    else
      res
        .status(status)
        .type("html")
        .send(
          "<h1>Unable to complete this request</h1><p>" +
            htmlEscape(message) +
            '</p><a href="/account/orders">Purchase history</a> · <a href="/">Home</a>',
        );
  });
  return app;
}
// Default export for serverless hosts such as Vercel: a request handler that
// starts the database and application on first use, then reuses them.
let booting;
export default function handler(req, res) {
  booting ??= import("./bootstrap.js").then((m) => m.boot());
  booting.then(
    ({ app }) => app(req, res),
    (error) => {
      booting = undefined;
      console.error("Application startup failed:", error);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Service temporarily unavailable.");
    },
  );
}
