# MASTER DEVELOPMENT PROMPT: ALL-COURSE TVET PAPERS & STUDY RESOURCES PORTAL

Act as a senior full-stack engineer, product designer, database architect, and QA engineer. Build a complete, professional, working TVET Papers & Study Resources Portal for all TVET courses, including engineering, ICT, business, hospitality, agriculture, health-related training, and other disciplines. Keep courses and units configurable; do not hard-code the platform around engineering or CDACC alone.

Use this specification as the source of truth. Implement the actual application, database migrations, private document storage integration, payment integration, responsive interfaces, automated checks, and deployment documentation. Do not stop at a plan, mockup, or disconnected dashboards. Work through implementation and verification until the agreed scope is complete. Where external credentials are unavailable, implement the integration and sandbox tests, list the required configuration, and accurately identify what remains unverified.

## 1. Product and architecture

Working title: TVET Papers & Study Resources Portal. Make the platform name, logo, favicon, support contacts, and public information configurable. Use ELIAHTECH Digital Solutions as the default developer credit, configurable in settings. Do not imply official affiliation with TVET institutions or examining bodies.

Required stack:

- Node.js with Express for the backend.
- HTML, CSS, Bootstrap, and vanilla JavaScript for the frontend. EJS may be used for server-rendered HTML.
- Supabase PostgreSQL for relational data.
- Supabase private Storage buckets for paid documents and sensitive files.
- Pesapal API 3.0 for checkout and verified payments.
- PDF.js for PDF viewing.
- Secure server-side sessions with persistent storage and a maintained password-hashing implementation.
- One application serving the website and API, with clear controllers, routes, services, validators, middleware, database migrations, views, assets, jobs, and tests.

Use maintained, compatible dependency releases and document the Node.js runtime requirement. Consult current official documentation for external integrations during implementation. Do not use Next.js or add an unnecessary microservice architecture. Keep deployment portable; document persistent server hosting and optional container deployment. Do not store documents or session state only on an ephemeral local filesystem.

## 2. Visual design

Create a polished, consistent, mobile-first light theme:

- Deep navy #0F172A: navigation, sidebar, and headings.
- Teal #0F766E: primary actions, links, and active states.
- Soft white #F8FAFC: page background.
- White #FFFFFF: cards and forms.
- Slate #475569: supporting text.
- Gold #F59E0B: prices and restrained highlights.
- Semantic green, amber, and red for success, pending, and destructive states, paired with text/icons.

Use readable typography, generous spacing, modest shadows, consistent icons, clear forms, and accessible contrast. Verify keyboard operation, visible focus, labelled inputs, usable touch targets, and responsive tables. Include loading, empty, error, success, and offline/network-failure states. Avoid decorative clutter and horizontal overflow on phones.

Public pages need a professional header, course navigation, prominent search, account/cart access, and footer. Dashboards need a sidebar, mobile navigation, profile menu, notification bell with unread count, breadcrumbs, useful summary cards, and clear primary actions.

## 3. Roles and access

Roles: public visitor, student/customer, admin, and super admin.

Visitors browse and preview publicly listed resources without an account.

Student registration initially requires only full name, email, and phone number. No email verification, phone OTP, or activation approval is required to create the account. Automatically establish a session after successful registration. Prompt the user to set a password before checkout or leaving the initial account session; keep this as a short follow-up step without changing the three-field registration form.

Returning access must authenticate the existing account. Never open an account or expose purchases based only on a supplied name, email, or phone. Normalize identifiers, enforce uniqueness appropriately, and treat email/phone ownership as unverified until proven. Prevent recovery or profile edits from being used to take over another account. Use a single-use expiring recovery link sent to the existing email, with an administrator-assisted alternative. Recovery is separate from signup verification.

Admins and super admins sign in through a dedicated staff login. Only the super admin creates or manages admin accounts and permissions. No public registration can assign a staff role.

Implement authorization on every protected backend route and database operation. Hiding menu links is insufficient. Recheck account status and permissions for existing sessions, downloads, and purchases.

## 4. Public website and discovery

Build Home, All Resources, Courses, Course Details, Resource Details, Free Resources, About, Contact, FAQs, Privacy Policy, Terms, Purchase/Refund Policy, and Resource Access/Deletion Policy pages.

Home: clear introduction, search, featured courses, latest resources, free resources, a three-step purchase explanation, FAQs, and support access. Do not invent testimonials or institutional partnerships.

Search by title, unit name, or unit code. Filter by course, level, examining body, year, assessment series, resource type, free/paid, and price. Add sorting, pagination, result counts, clear filters, and meaningful empty states. Preserve search/filter state in URLs.

Resource types include past papers, revision papers, model papers, marking schemes, notes, and other authorized study documents. Distinguish resource types clearly. Do not fabricate an exhaustive official course list; provide representative demo data and admin tools/import templates to maintain the catalogue.

Resource cards and detail pages display title, course, unit/code, level, year, series, type, page count where available, file size, format, price in KES, availability, preview, and purchase action. Tapping the title or price opens the resource details/purchase flow. Purchased resources show Open in My Papers rather than inviting duplicate purchase.

Generate separate limited previews. Never use the complete paid document or its private storage URL as a public preview.

## 5. Profiles and student dashboard

Create professional profiles with avatar upload or initials, name, role badge, date joined, optional institution, course, and level. Include profile editing, password management, active-session controls, and sign-out. Contact information, payment records, and purchases are private. Users cannot edit their own role or account status.

Student dashboard:

- My Papers with search, filters, view/download actions, purchase date, and any scheduled access-ending notice.
- Wishlist.
- Cart and purchase history.
- Receipts.
- Notification inbox and unread count.
- Paper requests and request status.
- Support tickets and download/problem reports.
- Recent activity and recommendations based on chosen course, without unnecessary tracking.

Only confirmed entitlements appear as purchased papers. Do not expose another user's documents, orders, or support tickets by manipulating identifiers.

## 6. Checkout and Pesapal

Support single-resource purchases, a multi-item cart, and admin-defined course/unit bundles. Price all orders on the server using current database prices. Store immutable order-item snapshots of titles, prices, discounts, currency, and totals. Use integer minor units or exact database numeric types for money.

Flow: browse -> select paper/cart -> register or sign in -> review total and access terms -> Pesapal hosted checkout -> backend confirms payment -> entitlement created -> My Papers and receipt.

Implement Pesapal sandbox/live configuration, token handling, IPN registration/configuration, order submission, callback handling, IPN processing, transaction-status verification, and reconciliation using the current official API.

A redirect, browser parameter, screenshot, or client claim must never mark a payment successful. Query Pesapal from the backend and verify the provider order identifiers, expected amount, currency, and successful status. Use database transactions, uniqueness constraints, and idempotent fulfillment so duplicate, delayed, or out-of-order callbacks cannot create duplicate entitlements or receipts. Handle races between checkout and changes to resource availability.

Model order/payment states explicitly, including initiated, pending, completed, failed, and cancelled, with refund/reversal handling where supported. Preserve payment attempts and transaction references. Do not pretend a refund succeeded without a confirmed provider or documented manual process.

Provide pending-status polling with bounded retries, retry-payment UX, purchase history, receipts, admin reconciliation, and recovery when payment succeeds while the buyer is offline. Prevent repeat purchases of owned papers, including overlap within bundles.

## 7. Private files and purchased access

Keep paid originals in private Storage. Store object identifiers rather than public URLs. Issue short-lived signed download URLs only after backend authentication, account-status, and entitlement checks. Never expose privileged Supabase credentials to the browser.

Free files and limited previews may be public in separate locations. Validate upload size, extension, actual file signature/MIME type, and safe filenames. Reject unsafe file types. Support configurable limits, progress feedback, and bulk-upload error summaries. Use PDF as the primary format; handle approved additional formats explicitly.

Use PDF.js for authorized viewing and record download activity without exposing unnecessary personal data. Do not promise that viewing controls or signed URLs can prevent a buyer from copying or sharing downloaded files. Protect access and communicate those limits honestly.

Replacing an incorrect document preserves existing purchase access and records a version history. Ensure orders cannot refer to a resource without a usable file.

## 8. Assessment series and deletion lifecycle

Organize papers by named assessment series and year, for example November/December 2026.

Keep these actions separate:

1. Close/unpublish a series: hide its papers from the public catalogue and stop new purchases while existing buyers retain access.
2. Schedule permanent deletion: authorized admin selects affected papers or a whole series, reviews impact, provides a reason and future deletion date, and sends notices to affected buyers.
3. Execute deletion: after the configured notice period and a final explicit confirmation, remove the underlying files and end purchased access.

Notifications must state the exact affected resources/series, deletion date, and advice to download beforehand. Show the notice prominently in My Papers and the notification inbox. Support cancellation of scheduled deletion with an update notification. Block premature deletion through backend checks.

Show affected resource and buyer counts. Require the admin to type the series name for bulk destructive actions. Define the notice period as a configurable setting rather than silently inventing a fixed business rule.

Retain order, payment, receipt, entitlement-history, and audit records after document deletion. Show deleted items as unavailable with a clear explanation. Distinguish recoverable archive/soft-delete from actual permanent file deletion and document how backup retention affects recovery. Handle in-flight payments during deletion without granting broken access or silently retaining money without a resolution path.

## 9. Notifications

Provide student and staff notification bells with unread badges, an inbox, mark-one/all-read actions, pagination, priority, timestamp, and related links.

Admins can send notifications to one user, selected users, all users, a course/level group, buyers of a paper, or buyers in a series. Include announcements, newly available requested resources, support replies, payment events, urgent notices, and deletion reminders. Urgent messages should be labelled clearly.

Admins receive payment/problem alerts and paper requests. Respect permissions when viewing notification recipients. Snapshot the affected audience for deletion notices. Use a persistent job/outbox mechanism with retries to avoid lost or duplicated deliveries. In-app notifications are required; optional email notifications need a configured mail provider and must report delivery failures honestly.

## 10. Admin and super-admin dashboards

Admin capabilities, subject to assigned permissions:

- Dashboard statistics and actionable queues.
- Manage courses, levels, units/codes, examining bodies, resource types, and series.
- Upload single/multiple documents, set prices, attach previews, draft/review/publish, replace files, and archive resources.
- Manage bundles and free resources.
- Review paper requests and notify requesters when fulfilled.
- View/search orders, payments, receipts, pending transactions, and reconciliation results.
- View/manage support tickets and reported file problems.
- Send notifications and manage deletion notices.
- Search users by name, email, phone, course, and status.
- View user profiles and purchases; correct profile details; suspend/reactivate users with a reason; revoke sessions; assist recovery without seeing passwords.
- Export scoped reports and CSV data.

Suspension blocks authenticated access and new purchases, revokes sessions, and preserves financial records. Do not allow admins to promote themselves, edit super admins, or permanently delete users.

Super-admin capabilities:

- Create, disable, and manage admins and granular permissions.
- Manage global settings, branding, support contacts, access/deletion rules, and integration configuration.
- View global reports and audit logs.
- Manage exceptional account deletion/anonymization with impact confirmation and retention of required financial history.
- Prevent deletion/disablement of the last active super admin.
- Bootstrap the initial super admin through a secure setup command, never a published default password.

Store secrets in server environment variables or appropriate encrypted secret storage, not in public settings responses or source control.

## 11. Data model

Deliver versioned SQL migrations, indexes, constraints, and limited non-sensitive seed data. Use a coherent schema covering:
users, user_profiles, sessions, roles/permissions and assignments, courses, levels, units, examining_bodies, assessment_series, resource_types, resources, resource_files/versions, bundles/bundle_items, wishlists, carts/cart_items, orders/order_items, payment_attempts, payment_events, entitlements, receipts, paper_requests, notifications, notification_recipients, support_tickets/messages, download_logs, deletion_jobs/affected_resources/notices, job_outbox, audit_logs, and settings.

Adjust names/normalization to avoid redundant tables, but cover every behavior. Add foreign keys, meaningful indexes, unique payment and entitlement constraints, transactional writes, timestamps, and sensible deletion policies. Never cascade-delete financial history when users or papers are removed.

Use least-privilege database access and appropriate row-level policies for any browser-accessible Supabase surface. Never assume RLS protects a query executed through a privileged service credential; enforce authorization in backend code too.

## 12. Security, reliability, and operations

Implement validation, parameterized queries, output escaping, safe rich-text handling, CSRF protection for cookie-authenticated mutations, rate limits, session rotation, secure HttpOnly/SameSite cookies, production HTTPS, secure headers, upload validation, and strict role/object ownership checks.

Do not log secrets, passwords, full payment payloads unnecessarily, or signed URLs. Mask sensitive fields in logs and restrict exports. Protect CSV exports against spreadsheet formula injection.

Add structured operational logs, friendly error pages, health/readiness endpoints without secret disclosure, pagination, indexed search, caching where safe, and persistent background jobs for reconciliation, notifications, and scheduled actions. Document job scheduling so work does not depend on a browser being open or an unreliable in-process timer.

Document database/file backups and a tested restore procedure. Configure Africa/Nairobi for user-facing times and KES display while storing consistent timestamps.

## 13. SEO and performance

Provide useful unique titles/descriptions, canonical URLs, social metadata, favicon, sitemap.xml for public published pages, and robots.txt. Exclude account, admin, payment, private-file, and receipt pages from indexing. Authentication must protect these pages; robots.txt is not access control.

Use appropriate structured data only when accurate. Optimize images, lazy-load previews, keep scripts small, paginate results, and display document sizes before download. Ensure the site remains useful on low-bandwidth mobile connections.

## 14. Testing and acceptance criteria

Run meaningful integration and end-to-end checks for:

- Public browsing, searching, filtering, and pagination.
- Three-field account creation without activation verification, secure password setup/return login, and recovery.
- Student/admin/super-admin permissions and blocked unauthorized role changes.
- Cross-user purchase/download access denial.
- Profile editing, suspension, session revocation, and reactivation.
- Single purchase, cart and bundle pricing, duplicate ownership prevention, and server price validation.
- Successful, failed, cancelled, delayed, duplicate, and forged payment callbacks/IPNs; amount/currency mismatch; idempotent entitlements; reconciliation.
- Protected previews/originals, upload rejection, and file replacement preserving access.
- Series closure preserving buyer access.
- Scheduled deletion impact review, notices, cancellation, premature-deletion blocking, and preservation of financial history.
- Notification targeting/read states, support tickets, requests, and reports.
- Responsive interfaces, keyboard navigation, and clear error/empty states.

Use mocked provider responses for automated edge cases and Pesapal sandbox for real integration verification when credentials are available. Never claim live payments, email delivery, or deployment were tested if they were not.

## 15. Deliverables and completion

Deliver the complete source tree, package/lock files, SQL migrations, representative seed data, .env.example without real secrets, secure super-admin setup command, tests, deployment configuration, backup/restore instructions, and README.

README must explain local setup, Supabase setup, private bucket policies, Pesapal sandbox/live setup and IPN URLs, email configuration, job runner scheduling, environment variables, production deployment, and student/admin workflows.

Provide a concise completion report listing implemented modules, tests actually run and their results, configuration still required, and known limitations. Include a traceability checklist linking each requirement to its implementation and validation. Package the finished project for download where supported.

No nonfunctional buttons, fake payment-success flows, hardcoded dashboard statistics presented as live data, exposed paid originals, default production passwords, or unexplained unfinished modules. Clearly label demo data and development-only provider simulations. Make the system coherent, professional, secure, and ready for configuration and review before launch.

## Approved version 1.1 extension

Add a professional private AI study chat using server-side Gemini and Groq API keys, with explicit provider choice and automatic fallback. Add a signed-in course discussion and question centre with replies and administrator moderation. Use icon-based bottom navigation. After basic profile/password setup, automatically present a persistent feature guide with Next, Previous, Skip and Finish, plus replay from Profile. Keep existing purchase and document protections intact. See AI-COMMUNITY.md for the implemented configuration and validation.

## Approved version 1.2 extension

Add admin subscription payments to the super admin’s Pesapal merchant account. Only the super admin sets the amount and billing period. Include a normal-admin renewal page, owner subscription controls, verified payment-based access, expiry/payment history, receipts and reminders, preserving existing student purchases and account recovery. Use separate subscription payment records and owner credentials.
