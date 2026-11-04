import { test } from "node:test";
import assert from "node:assert/strict";
import { Pesapal } from "../src/services/pesapal.js";
test("Pesapal adapter authenticates and sends documented API 3 payloads", async () => {
  const calls = [];
  const p = new Pesapal({
    key: "test-key",
    secret: "test-secret",
    ipn: "test-ipn",
    appUrl: "https://portal.example",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("RequestToken"))
        return Response.json({ token: "test-bearer", status: "200" });
      if (url.includes("RegisterIPN")) return Response.json({ ipn_id: "ipn" });
      if (url.includes("SubmitOrderRequest"))
        return Response.json({
          merchant_reference: "attempt",
          order_tracking_id: "tracking",
          redirect_url: "https://cybqa.pesapal.com/checkout",
          status: "200",
        });
      return Response.json({ status: "200", status_code: 1 });
    },
  });
  await p.registerIpn();
  await p.submit(
    { id: "attempt" },
    { id: "order", amount_minor: 5050, currency: "KES" },
    {
      name: "Student Name",
      phone: "+254700000000",
      email: "student@example.test",
    },
  );
  await p.status("tracking");
  const submit = calls.find((c) => c.url.includes("SubmitOrderRequest"));
  assert.equal(JSON.parse(submit.options.body).amount, 50.5);
  assert.equal(JSON.parse(submit.options.body).notification_id, "test-ipn");
  assert.equal(
    JSON.parse(submit.options.body).callback_url,
    "https://portal.example/payments/callback",
  );
  assert.equal(submit.options.headers.Authorization, "Bearer test-bearer");
  assert.equal(calls.filter((c) => c.url.includes("RequestToken")).length, 1);
});
test("Pesapal adapter blocks missing credentials, bad provider responses and unsafe redirects", async () => {
  await assert.rejects(
    new Pesapal({ key: "", secret: "" }).status("tracking"),
    /not configured/,
  );
  const p = new Pesapal({
    key: "k",
    secret: "s",
    ipn: "i",
    fetcher: async (url) =>
      Response.json(
        url.includes("RequestToken")
          ? { token: "t" }
          : {
              merchant_reference: "a",
              order_tracking_id: "t",
              redirect_url: "https://evil.example/pay",
            },
      ),
  });
  await assert.rejects(
    p.submit(
      { id: "a" },
      { id: "o", amount_minor: 100, currency: "KES" },
      { name: "A B", email: "a@example.test", phone: "+254700000000" },
    ),
    /Invalid payment checkout/,
  );
});
