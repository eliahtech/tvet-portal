# Admin subscription payments — version 1.2

Normal admins can pay a platform-access fee to the super admin's Pesapal merchant account. The super admin alone sets the amount, billing period, terms and enabled state from **Subscriptions** in the super-admin dashboard. Admins use **My subscription** to review the fee, pay, check status, renew and open receipts.

This implementation provides admin-initiated renewal payments. It does not enroll cards or mobile-money accounts into automatic recurring deductions.

## Upgrade

Back up the database and private files. Deploy the updated source, run `npm ci`, then use the migration-owner connection to run:

```bash
npm run db:migrate
npm run db:runtime-role
```

Migration `004_admin_subscriptions.sql` adds the plan and separate subscription orders, attempts, periods, events and reminder records. It leaves subscriptions **disabled by default**, with no fee charged or imposed on existing admins. The super admin must configure and enable the plan. Existing users, purchased papers, receipts and AI/community features remain in place.

Restore the restricted runtime connection after setup, then restart the web server and scheduled job runner. Production startup requires this migration. Local development applies it on startup; stop PGlite before running separate setup commands.

## Connect the super admin's Pesapal merchant account

Set these values in the private server environment:

```text
OWNER_PESAPAL_ENV=sandbox
OWNER_PESAPAL_CONSUMER_KEY=
OWNER_PESAPAL_CONSUMER_SECRET=
OWNER_PESAPAL_IPN_ID=
```

Use the merchant credentials for the super admin's own Pesapal account. These credentials determine the receiving merchant; an administrator cannot choose a payee, supply a different merchant key or change the amount from checkout. Do not place keys in frontend files, public settings or chat messages.

This configuration has **no fallback** to the `PESAPAL_*` credentials used for student paper sales. If both payment flows should settle into the same merchant account, deliberately configure the same merchant credentials in both server configurations, while keeping each flow's IPN identifier/routes correctly registered. Do not change the owner merchant account while old payments are unresolved without arranging access to the original merchant records.

After setting the owner's sandbox key/secret and a real HTTPS `APP_URL`, register the subscription IPN:

```bash
npm run subscription:ipn
```

Save the returned ID as `OWNER_PESAPAL_IPN_ID`. Restart the application. The subscription routes are:

- IPN: `POST /api/subscriptions/ipn`
- Browser return: `/payments/subscription-callback`
- Return/cancellation page: `/admin/subscription`

They are separate from paper-sales callbacks and ledgers. Test the complete renewal flow in the owner's Pesapal sandbox account before switching to `OWNER_PESAPAL_ENV=live` with that account's live credentials and IPN registration. No real owner merchant credentials or live transaction were supplied for this delivery.

## Super-admin controls

Open **Subscriptions** (`/admin/subscriptions`). Configure:

- Plan name and terms.
- Fee in KES, up to KES 1,000,000; an enabled plan requires a positive amount.
- Billing period from one to 366 days. For example, thirty days is an exact thirty-day period, not a calendar-month calculation.
- Whether paid admin access is required.

The app prevents enabling the requirement until the owner payment connection is configured. The super admin can save a disabled plan while configuring credentials. Enabling it immediately requires normal admins without active paid access to renew. Super admins are exempt.

Existing paid periods retain their dates when the plan changes. Existing payment orders retain the price, period and terms quoted when they were created. A stale plan-version submission is rejected so admins must refresh and review a changed fee before creating a new order.

The owner dashboard shows each admin's access status and expiry, subscription payments, receipts and reconciliation actions. Only the super admin can recover a tracking reference from the owner's merchant dashboard for an interrupted submission. Subscription totals/history are separate from student sales; the dashboard's displayed fee total covers its listed history, which is capped at 500 orders.

## Admin payment and access

Open **My subscription** (`/admin/subscription`), review the fee/period/terms, accept them and continue to Pesapal. Access changes only after a server-to-server status check validates the stored provider reference, merchant reference, amount, currency and successful status.

An early renewal starts after the latest existing unrevoked paid period, preserving remaining time. Renewal after ordinary expiry starts at payment confirmation. Duplicate IPNs/callbacks create no additional period or receipt. Failed or client-claimed successful payments do not activate management access.

The subscription gates normal-admin management routes and privileged file access on each request. It also gates moderation permissions. It does not remove the admin's assigned permissions, suspend their account, delete data or revoke student purchases. An expired admin can still sign in, edit their own profile/security, read their notifications and open subscription billing/history/receipts to renew. Any independently purchased documents remain accessible through normal ownership checks.

If the global requirement is disabled, normal admins recover their assigned management permissions without needing another payment. Existing paid-period dates are retained; disabling the requirement does not pause the clock on a paid period.

## Pending payments and reversals

A submitted checkout is reused rather than silently creating another charge. Only one unresolved order is allowed per admin. If provider submission times out after acceptance, the order becomes `submission_unknown` and another checkout is blocked. The super admin can find the attempt ID in the owner's Pesapal merchant records, recover the tracking ID and use **Recover reference**. The server verifies the merchant reference, amount and currency before linking and reconciling it.

Failed hosted checkout links can be resumed where supported by the provider. If a failed/unknown checkout cannot be resumed or reconciled, resolve it with the owner/provider before making a replacement payment. There is no manual “mark paid” bypass, automatic refund endpoint or automatic new-charge retry in this release.

A confirmed reversal revokes the access period credited by that payment and retains the financial/audit history. Other paid periods retain their original dates. Reversing an earlier period can therefore create a gap before a future prepaid period; My subscription displays the next start date and directs the admin to the super admin for resolution. A late failed notification does not downgrade a previously confirmed payment, and a reversed payment is not reactivated by a stale completed notification.

## Background reconciliation and reminders

The existing `npm run jobs` scheduler now also reconciles unresolved owner payments and sends in-app renewal notices. It does not require an admin to return from Pesapal. Run it every minute with the same owner configuration as the server. Local development's in-process runner performs the same persisted jobs while the server is running.

An expiring notice is issued within the final three days, and an expiry notice after the paid period ends. Reminder records prevent repeated notices for the same period/type. Expiry enforcement happens on requests even if the scheduler is temporarily stopped. Subscription confirmations/reversals notify the paying admin and super admins.

## Validation

Automated coverage includes super-admin-only fee controls, forged amount/period fields, plan-version changes, owner-versus-paper merchant separation, duplicate IPNs, early/expired renewal, wrong amounts/currencies/references, failures/reversals, ambiguous submissions/reference recovery, request-time restrictions, retained member/paper access, reminders and scheduled reconciliation. The subscription dashboard and owner controls are rendered through the API/DOM harness.

Live owner-account onboarding, settlement, Pesapal sandbox/live checkout and production deployment still require the operator's credentials and verification.
