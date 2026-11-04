# Implementation and requirement mapping

The application is implemented as one Express server with a Bootstrap/vanilla JavaScript frontend, direct PostgreSQL access and private Supabase Storage. Local mode uses PGlite for an actual PostgreSQL engine without remote credentials. Production requires remote PostgreSQL and private Supabase Storage. No development data or credentials are shipped in the archive.

| Requirement                                | Implementation                                                                       | Verification                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| All-course catalogue and unit search       | `src/routes-public.js`, `public/app.js`, course/unit administration and CSV importer | Search, filters, pagination, injection checks; browser search                                      |
| Three-field registration, no activation    | `src/auth.js`, auth routes in `src/app.js`                                           | Registration without OTP, returning login and password gate tests                                  |
| Student/admin/super-admin separation       | `src/auth.js`, permission middleware and staff routes                                | Cross-role denial, scoped admin, last-super-admin tests                                            |
| Professional profiles and sessions         | `src/routes-account.js`                                                              | Profile/contact protection, password, session and DOM-screen checks                                |
| Paid/private originals and limited preview | `src/services/storage.js`, `/api/files/:id`, PDF.js viewer                           | Cross-user denial, private storage adapter, raster text inspection; browser preview                |
| Cart, bundles and server pricing           | `src/services/orders.js`, cart/bundle routes                                         | Price snapshots, overlap and duplicate-purchase tests                                              |
| Pesapal hosted checkout                    | `src/services/pesapal.js`                                                            | API payload/token/redirect unit tests; live sandbox connection pending credentials                 |
| Verified payment access                    | `src/services/orders.js`, callback/IPN routes                                        | Successful/failed/delayed/forged/mismatched/duplicate/reversed events and IPN tests                |
| Purchase history and receipts              | Orders/receipt routes, receipt modal and print stylesheet                            | Receipt uniqueness and cross-user ownership tests; DOM route checks                                |
| Notifications and targeting                | `src/services/notifications.js`, notification routes                                 | Targeting, private read-state and student-authoring denial tests                                   |
| Paper requests and support                 | Account/admin request and ticket routes                                              | Ownership checks, staff replies, notification delivery and DOM screens                             |
| Admin uploads, editing and replacement     | `src/routes-admin.js`, upload/edit forms                                             | PDF rejection and replacement retaining purchase access; DOM screens                               |
| Series closure                             | Admin series routes                                                                  | Public removal with purchased access preserved                                                     |
| Scheduled deletion and notices             | `src/services/deletion.js`                                                           | Impact/confirmation, pending-order guard, notice/cancellation/deadline and physical deletion tests |
| User suspension/reactivation               | Admin user routes                                                                    | Session revocation, preserved orders and restored login                                            |
| Reports, CSV export and audit              | Admin report/audit routes                                                            | HTTP response and DOM tests, formula-safe CSV helper                                               |
| Configurable branding and policies         | Settings, PNG branding routes and public branding endpoints                          | Role denial and DOM settings screen; default logo checked in browser                               |
| Database integrity and RLS                 | Versioned SQL migrations and runtime-role helper                                     | Real local PostgreSQL migrations/constraints; managed runtime permissions need host verification   |
| Persistent jobs and recovery email         | `src/jobs.js`, `scripts/jobs.js`                                                     | Mock mail delivery, expiring single-use tokens and session revocation                              |
| Backups                                    | Local backup helper; production operating procedure                                  | Real local data-directory and private-byte restore test; remote restore not executed               |
| SEO and responsiveness                     | Metadata injection, sitemap/robots, CSS breakpoints, mobile navigation               | SEO endpoint and DOM tests; desktop browser inspection; no real-device mobile test                 |
| Portable deployment                        | Docker, Compose, systemd/Nginx examples and environment guide                        | Source/config checks only; no container build or live deployment performed                         |

## Scope details

- Normal users authenticate returning access, but do not verify email/phone to create an account. This preserves the agreed signup experience and protects purchases.
- The default minimum deletion notice is seven days and can be changed by the super admin before sales. A completed permanent deletion removes online purchased access. Closing a series alone never does.
- Originals and all prior original versions are removed on confirmed series deletion; transaction, receipt and entitlement-history records remain.
- Supabase service credentials, provider secrets and SMTP credentials remain server-only. Anonymous Supabase table access is disabled by migration.
- The frontend is tested against real application APIs through a synthetic DOM harness. Actual browser checks covered the public home page, catalogue search, paper details and PDF preview. Authenticated screens were not manually signed into through the browser.
- Automated payment tests use synthetic provider replies, with no user-facing fake-payment-success endpoint. The real adapter remains unverified against a merchant account until credentials are configured.

## Version 1.1 additions

| Requirement                        | Implementation                                                 | Verification                                                                                       |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Private Gemini/Groq AI chat        | `src/services/ai.js`, `src/routes-social.js`, AI StudyMate UI  | Provider-header/payload/fallback tests; consent, ownership, context, quotas and idempotency checks |
| User discussion/question centre    | `src/routes-social.js`, course-topic and reply UI              | Topic/reply access, reports, moderation, suspension and audit checks                               |
| Bottom navigation with icons       | `bottomNav()` and responsive navigation styles                 | Five links and active state in DOM tests; public browser inspection                                |
| Automatic Next/Previous/Skip guide | Per-user guide columns, onboarding endpoints and native dialog | Eligibility, persisted steps, completion/skip and replay tested in DOM/API harness                 |

Version 1.1 adds migration `003_ai_community_tour.sql`. Run migrations and the runtime-role helper before restarting an existing installation. See `AI-COMMUNITY.md` for configuration and user/admin workflows. Real Gemini/Groq calls have not been verified without API keys.

## Configuration still required before launch

Gemini/Groq keys and model selection, remote database connection and runtime role, private Supabase bucket/service credentials, actual course/unit/document data, Pesapal sandbox then live merchant credentials/IPN, SMTP, domain/HTTPS, job scheduling, support details, published policies and a production backup/restore rehearsal.

## Version 1.2 additions

Admin subscriptions use a separate owner-configured Pesapal account and payment ledger. Only super admins set the fee, period, terms and activation. Normal admins can pay/renew, view receipts and recover expired management access after verified payment. Scheduled reconciliation and deduplicated expiry notices are included. All existing roles and purchased-paper protections remain. See `ADMIN-SUBSCRIPTIONS.md` for migration `004_admin_subscriptions.sql`, credential configuration and operational limits.

## Known limits

See `OPERATIONS.md` for list/export caps, PDF-only resources, process-local rate limiting, client-side page rendering and manual/provider refunds. The supplied source supports the agreed core system; it is not a claim that external services, hosting, legal policy text or a complete official TVET curriculum have already been provisioned.
