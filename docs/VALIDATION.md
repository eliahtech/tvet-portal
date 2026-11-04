# Delivery validation — 1 November 2026

- `npm run check`: passed for all application, frontend, script and test JavaScript files.
- `npm test`: 82 passed, 0 failed, 0 skipped. Complete output: `test-results.txt`.
- `npm audit --omit=dev`: 0 reported vulnerabilities at delivery. Output: `dependency-audit.txt`.
- Runtime used: Node.js 24.22.1.
- Public browser checks: home layout, catalogue search by unit code, paper details and PDF.js limited preview rendering.
- Synthetic DOM checks: 42 public, student and staff screen routes, backed by real application API responses.
- Private storage integration: local filesystem and mocked Supabase SDK adapter tests. No connection to a real Supabase account was made.
- Payments: documented API payload/token handling and verified-status access controls tested with synthetic provider replies. Tests include forged/duplicate IPNs, amount/currency/reference mismatches, reversals, interrupted submissions and overlap prevention. No real payment was taken.
- Backup: persisted local PostgreSQL directory and private bytes restored into a separate location and checked.
- Catalogue import: quoted CSV fields, unit updates, invalid-row rollback and isolation from unrelated tables tested.

Version 1.1 additionally validates Gemini/Groq request shapes and server-side headers, automatic fallback, private chat ownership (including against staff), consent, context isolation, budgets, request replay, community moderation/reporting, and guide eligibility/Next/Previous/Skip/replay. The bottom navigation and signed-out AI redirect were checked in the browser; authenticated additions were checked with the API/DOM harness.

Version 1.2 additionally checks super-admin-only fee controls, price/period snapshots, owner-versus-paper merchant routing, idempotent renewals, expiry access control, retained student purchases, ambiguous submission recovery, reversals, receipts, reminders and scheduled reconciliation. Billing screens were rendered against real API responses in the DOM harness.

Live owner-subscription checkout, Gemini/Groq calls, Pesapal sandbox/live transactions, remote PostgreSQL permissions, remote bucket configuration, actual SMTP delivery, a production restore rehearsal, container build, load testing and physical mobile-device testing remain deployment checks. No live website deployment is claimed.

Error-level checkout and AI logs in the test output are intentional: the suite simulates provider failures to verify safe handling. A PDF standard-font warning in the text-inspection test does not represent a failed assertion or a failed browser preview render.
