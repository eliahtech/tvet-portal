import {
  token,
  digest,
  one,
  fail,
  id,
  hashPassword,
  verifyPassword,
  phone,
  publicUser,
  audit,
} from "./util.js";
import { z } from "zod";
export const permissions = [
  "resources",
  "catalogue",
  "users",
  "payments",
  "notifications",
  "support",
  "reports",
  "deletion",
  "community",
];
export function has(u, p) {
  return (
    u?.role === "super_admin" ||
    (u?.role === "admin" &&
      !u.subscription_blocked &&
      u.permissions.includes(p))
  );
}
export const requireUser = (req, res, next) => {
  if (!req.user) fail(401, "Please sign in to continue");
  next();
};
export const allow = (p) => (req, res, next) => {
  if (req.user?.role === "admin" && req.user.subscription_blocked)
    fail(402, "Renew your admin subscription to use this feature");
  if (!has(req.user, p))
    fail(403, "You do not have permission for this action");
  next();
};
export const superOnly = (req, res, next) => {
  if (req.user?.role !== "super_admin")
    fail(403, "Super admin access required");
  next();
};
export const text = (v, min = 1, max = 200) => {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
    fail(400, "Enter a value between " + min + " and " + max + " characters");
  return v.trim();
};
export function password(p) {
  if (typeof p !== "string" || p.length < 12 || p.length > 128)
    fail(400, "Use a password between 12 and 128 characters");
  return p;
}
export function identity(body) {
  const name = text(body.name, 2, 100),
    email = text(body.email, 3, 254).toLowerCase(),
    p = phone(body.phone);
  if (!z.email().safeParse(email).success || !/^\+[1-9]\d{7,14}$/.test(p))
    fail(
      400,
      "Enter a valid email and international phone number, such as +254712345678",
    );
  return { name, email, phone: p };
}
export async function newSession(db, req, res, userId = null) {
  const secret = token(),
    csrf = token();
  if (req.sessionId)
    await db.query("DELETE FROM sessions WHERE id=$1", [req.sessionId]);
  const sid = digest(secret);
  await db.query(
    "INSERT INTO sessions(id,user_id,csrf,user_agent,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
    [sid, userId, csrf, (req.get("user-agent") || "").slice(0, 300)],
  );
  res.cookie("tvet_session", secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 86400000,
    path: "/",
  });
  req.sessionId = sid;
  req.csrf = csrf;
  return csrf;
}
export function authMiddleware(db) {
  return async (req, res, next) => {
    const raw = req.cookies.tvet_session;
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const sid = digest(raw),
        s = await one(
          db,
          "SELECT * FROM sessions WHERE id=$1 AND expires_at>now()",
          [sid],
        );
      if (s) {
        req.sessionId = sid;
        req.csrf = s.csrf;
        if (s.user_id) {
          const u = await one(db, "SELECT * FROM users WHERE id=$1", [
            s.user_id,
          ]);
          if (u?.status === "active") req.user = u;
          else await db.query("DELETE FROM sessions WHERE id=$1", [sid]);
        }
      }
    }
    next();
  };
}
export function csrf(req, res, next) {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path === "/api/payments/ipn" ||
    req.path === "/api/subscriptions/ipn"
  )
    return next();
  if (!req.csrf || req.get("x-csrf-token") !== req.csrf)
    fail(403, "Your session has expired. Refresh the page and try again.");
  const origin = req.get("origin"),
    expected = process.env.APP_URL || req.protocol + "://" + req.get("host");
  if (origin && origin !== new URL(expected).origin)
    fail(403, "Invalid request origin");
  next();
}
export async function register(db, req, res) {
  const profile = identity(req.body),
    uid = id();
  await db.query("INSERT INTO users(id,name,email,phone) VALUES($1,$2,$3,$4)", [
    uid,
    profile.name,
    profile.email,
    profile.phone,
  ]);
  const csrf = await newSession(db, req, res, uid);
  res.json({
    user: publicUser(await one(db, "SELECT * FROM users WHERE id=$1", [uid])),
    csrf,
    needsPassword: true,
  });
}
export async function login(db, req, res, staff = false) {
  const email = text(req.body.email, 3, 254).toLowerCase();
  const u = await one(db, "SELECT * FROM users WHERE email=$1", [email]);
  if (
    !u ||
    u.status !== "active" ||
    (staff
      ? !["admin", "super_admin"].includes(u.role)
      : u.role !== "student") ||
    !(await verifyPassword(String(req.body.password || ""), u.password_hash))
  )
    fail(401, "Email or password is incorrect, or this account is unavailable");
  const csrf = await newSession(db, req, res, u.id);
  await audit(db, u.id, "login", u.id);
  res.json({ user: publicUser(u), csrf });
}
