import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerPesapal } from "../src/services/subscriptions.js";
test("owner checkout uses owner credentials and distinct IPN/callback routes", async () => {
  const names = [
    "OWNER_PESAPAL_CONSUMER_KEY",
    "OWNER_PESAPAL_CONSUMER_SECRET",
    "OWNER_PESAPAL_IPN_ID",
  ];
  const old = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    OWNER_PESAPAL_CONSUMER_KEY: "synthetic-owner-key",
    OWNER_PESAPAL_CONSUMER_SECRET: "synthetic-owner-secret",
    OWNER_PESAPAL_IPN_ID: "synthetic-owner-ipn",
  });
  try {
    const p = ownerPesapal();
    p.appUrl = "https://portal.example";
    const requests = [];
    p.fetcher = async (url, options) => {
      requests.push({
        url,
        body: options.body ? JSON.parse(options.body) : null,
      });
      return Response.json(
        url.includes("RequestToken")
          ? { token: "synthetic-token" }
          : url.includes("RegisterIPN")
            ? { ipn_id: "owner-ipn" }
            : {
                merchant_reference: "owner-attempt",
                order_tracking_id: "owner-track",
                redirect_url: "https://cybqa.pesapal.com/checkout",
              },
      );
    };
    await p.registerIpn();
    await p.submit(
      { id: "owner-attempt" },
      { id: "owner-order", currency: "KES", amount_minor: 150000 },
      {
        name: "Test Admin",
        email: "admin@example.test",
        phone: "+254700000000",
      },
    );
    assert.equal(
      requests.find((r) => r.url.includes("RequestToken")).body.consumer_key,
      "synthetic-owner-key",
    );
    assert.equal(
      requests.find((r) => r.url.includes("RegisterIPN")).body.url,
      "https://portal.example/api/subscriptions/ipn",
    );
    const b = requests.find((r) => r.url.includes("SubmitOrderRequest")).body;
    assert.equal(b.notification_id, "synthetic-owner-ipn");
    assert.equal(
      b.callback_url,
      "https://portal.example/payments/subscription-callback",
    );
    assert.equal(
      b.cancellation_url,
      "https://portal.example/admin/subscription",
    );
    assert.equal(b.amount, 1500);
  } finally {
    for (const k of names) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
