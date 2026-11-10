import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
const get = (server, path) =>
  new Promise((resolve, reject) =>
    http
      .get({ port: server.address().port, path }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject),
  );
const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
test("src/app.js default export is a request handler that starts the app on first use", async () => {
  process.env.DATA_DIR = ":memory:";
  delete process.env.DATABASE_URL;
  delete process.env.NODE_ENV;
  const { default: handler } = await import("../src/app.js");
  assert.equal(typeof handler, "function");
  const server = await listen(handler);
  try {
    assert.equal((await get(server, "/health")).status, 200);
    assert.equal((await get(server, "/health")).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("handler answers 503-style failure cleanly and retries when production settings are missing", async () => {
  const saved = { ...process.env };
  process.env.NODE_ENV = "production";
  for (const k of [
    "DATABASE_URL",
    "APP_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])
    delete process.env[k];
  const { default: handler } = await import(
    "../src/app.js?fresh=" + Date.now()
  );
  const server = await listen(handler);
  const log = console.error;
  console.error = () => {};
  try {
    const first = await get(server, "/");
    assert.equal(first.status, 500);
    assert.equal(first.body, "Service temporarily unavailable.");
    const second = await get(server, "/");
    assert.equal(second.status, 500);
  } finally {
    console.error = log;
    process.env = saved;
    await new Promise((r) => server.close(r));
  }
});
