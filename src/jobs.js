import nodemailer from "nodemailer";
import { id, one, rows } from "./util.js";
import { reconcile } from "./services/orders.js";
import {
  ownerPesapal,
  reconcileSubscription,
  subscriptionReminders,
} from "./services/subscriptions.js";
export async function runJobs(
  db,
  provider,
  { mailer, ownerProvider = ownerPesapal() } = {},
) {
  const result = { processed: 0, failed: 0, reconciled: 0 };
  const transport =
    mailer ||
    (process.env.SMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === "true",
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
          connectionTimeout: 15000,
        })
      : null);
  // Expired leases become eligible after crashes. Multi-worker claims use row locks.
  await db.query(
    "UPDATE jobs SET state='pending',locked_at=NULL WHERE state='running' AND locked_at<now()-interval '10 minutes'",
  );
  for (let i = 0; i < 25; i++) {
    const j = await db.tx(async (t) => {
      const j = await one(
        t,
        "SELECT * FROM jobs WHERE state='pending' AND run_after<=now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!j) return null;
      await t.query(
        "UPDATE jobs SET state='running',attempts=attempts+1,locked_at=now() WHERE id=$1",
        [j.id],
      );
      return j;
    });
    if (!j) break;
    try {
      if (j.kind === "password_reset") {
        if (!transport || !process.env.MAIL_FROM)
          throw Error("Mail delivery is not configured");
        const u = await one(
          db,
          "SELECT email FROM users WHERE id=$1 AND status='active'",
          [j.payload.user_id],
        );
        const r = await one(
          db,
          "SELECT id FROM password_resets WHERE id=$1 AND used_at IS NULL AND expires_at>now()",
          [j.payload.reset_id],
        );
        if (u && r)
          await transport.sendMail({
            from: process.env.MAIL_FROM,
            to: u.email,
            subject: "Reset your TVET portal password",
            text:
              "Use this single-use password recovery link within 30 minutes:\n" +
              j.payload.url +
              "\nIf you did not request this, ignore this message.",
          });
      } else throw Error("Unknown job type");
      await db.query(
        "UPDATE jobs SET state='completed',payload='{}',last_error=NULL WHERE id=$1",
        [j.id],
      );
      result.processed++;
    } catch {
      await db.query(
        "UPDATE jobs SET state=$2,run_after=now()+interval '5 minutes',last_error='Delivery failed. Check mail configuration and service availability.' WHERE id=$1",
        [j.id, j.attempts >= 4 ? "failed" : "pending"],
      );
      result.failed++;
    }
  }
  if (provider.configured())
    for (const a of await rows(
      db,
      "SELECT a.tracking_id FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.tracking_id IS NOT NULL AND o.status IN ('pending','initiated','needs_review') AND (a.checked_at IS NULL OR a.checked_at<now()-interval '2 minutes') ORDER BY a.created_at LIMIT 25",
    ))
      try {
        await reconcile(db, provider, a.tracking_id);
        result.reconciled++;
      } catch {
        result.failed++;
      }
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  result.subscription_reconciled = 0;
  if (ownerProvider.configured())
    for (const attempt of await rows(
      db,
      "SELECT a.tracking_id FROM subscription_attempts a JOIN subscription_orders o ON o.id=a.order_id WHERE a.tracking_id IS NOT NULL AND o.status IN ('initiated','pending','submission_unknown','needs_review') AND (a.checked_at IS NULL OR a.checked_at<now()-interval '2 minutes') ORDER BY a.created_at LIMIT 25",
    ))
      try {
        await reconcileSubscription(db, ownerProvider, attempt.tracking_id);
        result.subscription_reconciled++;
      } catch {
        result.failed++;
      }
  result.subscription_reminders = await subscriptionReminders(db);
  await db.query(
    "DELETE FROM password_resets WHERE expires_at<now()-interval '1 day'",
  );
  // Purge failed/expired reset-link payloads so tokens are not retained in the queue.
  await db.query(
    "UPDATE jobs SET payload='{}',state='expired' WHERE kind='password_reset' AND created_at<now()-interval '1 hour' AND state<>'completed'",
  );
  return result;
}
