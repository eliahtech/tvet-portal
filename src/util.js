import {
  randomUUID,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("hex");
export const digest = (x) => createHash("sha256").update(x).digest("hex");
const scrypt = promisify(scryptCb);
export async function hashPassword(p) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(p, salt, 64)).toString("hex");
}
export async function verifyPassword(p, h) {
  if (!h) return false;
  const [s, k] = h.split(":");
  const a = Buffer.from(k, "hex"),
    b = await scrypt(p, s, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export const one = async (db, s, p = []) => (await db.query(s, p)).rows[0];
export const rows = async (db, s, p = []) => (await db.query(s, p)).rows;
export const audit = (db, actor, action, target = "", detail = {}) =>
  db.query(
    "INSERT INTO audit_logs(id,actor_id,action,target,detail) VALUES($1,$2,$3,$4,$5)",
    [id(), actor, action, target, JSON.stringify(detail)],
  );
export const publicUser = (u) =>
  u
    ? Object.fromEntries(
        Object.entries(u).filter(
          ([k]) => !["password_hash", "avatar_key"].includes(k),
        ),
      )
    : null;
export const phone = (x) => {
  let s = String(x).replace(/[\s()-]/g, "");
  if (/^0[17]\d{8}$/.test(s)) s = "+254" + s.slice(1);
  if (/^254[17]\d{8}$/.test(s)) s = "+" + s;
  return s;
};
export function page(q) {
  const n = Math.max(1, Math.min(100000, Number(q.page) || 1)),
    size = 12;
  return { page: n, size, offset: (n - 1) * size };
}
export const csvCell = (x) =>
  '"' +
  String(x ?? "")
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
