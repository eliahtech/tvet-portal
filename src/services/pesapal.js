import { fail } from "../util.js";
export class Pesapal {
  constructor({
    key = process.env.PESAPAL_CONSUMER_KEY,
    secret = process.env.PESAPAL_CONSUMER_SECRET,
    environment = process.env.PESAPAL_ENV || "sandbox",
    ipn = process.env.PESAPAL_IPN_ID,
    appUrl = process.env.APP_URL || "http://localhost:3000",
    fetcher = fetch,
    ipnPath = "/api/payments/ipn",
    callbackPath = "/payments/callback",
    cancellationPath = "/account/orders",
    descriptionPrefix = "TVET study resources",
  } = {}) {
    Object.assign(this, {
      key,
      secret,
      ipn,
      appUrl,
      fetcher,
      ipnPath,
      callbackPath,
      cancellationPath,
      descriptionPrefix,
    });
    this.base =
      environment === "live"
        ? "https://pay.pesapal.com/v3/api"
        : "https://cybqa.pesapal.com/pesapalv3/api";
  }
  configured() {
    return !!(this.key && this.secret && this.ipn);
  }
  async request(endpoint, body, auth = true) {
    if (!this.key || !this.secret)
      fail(
        503,
        "Pesapal is not configured. Contact the administrator; no payment has been taken.",
      );
    const token = auth ? await this.token() : null;
    const r = await this.fetcher(this.base + endpoint, {
      method: body ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) fail(502, "Payment provider is temporarily unavailable");
    const j = await r.json();
    if (j.error?.code || Number(j.status) >= 400)
      fail(502, "Payment provider could not complete this request");
    return j;
  }
  async token() {
    if (this.bearer && this.expires > Date.now()) return this.bearer;
    const r = await this.request(
      "/Auth/RequestToken",
      { consumer_key: this.key, consumer_secret: this.secret },
      false,
    );
    if (!r.token) fail(502, "Payment authentication failed");
    this.bearer = r.token;
    this.expires = Date.now() + 4 * 60 * 1000;
    return r.token;
  }
  registerIpn() {
    return this.request("/URLSetup/RegisterIPN", {
      url: this.appUrl + this.ipnPath,
      ipn_notification_type: "POST",
    });
  }
  async submit(attempt, order, user) {
    if (!this.configured())
      fail(
        503,
        "Pesapal is not configured. Your order is saved; no payment has been taken.",
      );
    const r = await this.request("/Transactions/SubmitOrderRequest", {
      id: attempt.id,
      currency: order.currency,
      amount: order.amount_minor / 100,
      description: this.descriptionPrefix + " " + order.id.slice(0, 8),
      callback_url: this.appUrl + this.callbackPath,
      cancellation_url: this.appUrl + this.cancellationPath,
      notification_id: this.ipn,
      billing_address: {
        email_address: user.email,
        phone_number: user.phone,
        country_code: "KE",
        first_name: user.name.split(" ")[0],
        last_name: user.name.split(" ").slice(1).join(" "),
      },
    });
    if (r.merchant_reference !== attempt.id || !r.order_tracking_id)
      fail(502, "Unexpected payment provider response");
    const u = new URL(r.redirect_url);
    if (
      u.protocol !== "https:" ||
      !["pay.pesapal.com", "cybqa.pesapal.com"].includes(u.hostname)
    )
      fail(502, "Invalid payment checkout address");
    return r;
  }
  status(tracking) {
    return this.request(
      "/Transactions/GetTransactionStatus?orderTrackingId=" +
        encodeURIComponent(tracking),
    );
  }
}
