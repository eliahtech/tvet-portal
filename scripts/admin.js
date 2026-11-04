import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { openDb, migrate } from "../src/db.js";
import { id, hashPassword, audit } from "../src/util.js";
import { identity, password } from "../src/auth.js";
let hidden = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: !!process.stdin.isTTY,
});
const db = await openDb();
try {
  await migrate(db);
  const profile = identity({
    name: await rl.question("Full name: "),
    email: await rl.question("Email: "),
    phone: await rl.question("Phone (+254…): "),
  });
  process.stdout.write("Password (12+ characters, hidden): ");
  hidden = true;
  const p = await rl.question("");
  hidden = false;
  process.stdout.write("\n");
  const hash = await hashPassword(password(p)),
    uid = id();
  await db.tx(async (t) => {
    await t.query(
      "INSERT INTO users(id,name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,'super_admin')",
      [uid, profile.name, profile.email, profile.phone, hash],
    );
    await audit(t, uid, "super_admin.bootstrapped", uid);
  });
  console.log("Super admin created. Sign in at /staff/login.");
} catch (e) {
  console.error(
    e.code === "23505"
      ? "These account details are already in use."
      : e.message,
  );
  process.exitCode = 1;
} finally {
  hidden = false;
  rl.close();
  await db.close();
}
