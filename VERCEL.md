# Deploying to Vercel with Supabase only

Everything is created automatically on the first visit: database tables, the private `papers` storage bucket and (optionally) your first super admin. Nothing needs to be run on your computer.

## Vercel > Settings > Environment Variables (Production)
| Variable | Value |
|---|---|
| DATABASE_URL | Supabase > Connect > **Transaction pooler** string (with your database password) |
| DATABASE_SSL | `no-verify` (simplest), or leave unset and set PG_CA_CERT to the Supabase certificate |
| SUPABASE_URL | Supabase > Project Settings > API > Project URL |
| SUPABASE_SERVICE_ROLE_KEY | Supabase > Project Settings > API > service_role key (secret) |
| APP_URL | your https Vercel/own domain |
| STORAGE_BUCKET | `papers` (optional, default) |
| MAX_UPLOAD_MB | `4` (Vercel body limit is ~4.5 MB) |
| CRON_SECRET | any long random string |
| ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), ADMIN_PHONE (+254...), ADMIN_NAME | first super admin, created once; **remove ADMIN_PASSWORD after first login** |

Optional later: PESAPAL_*, OWNER_PESAPAL_*, SMTP_*, MAIL_FROM, GEMINI_API_KEY, GROQ_API_KEY.
Do NOT set PORT, DATA_DIR or TRUST_PROXY. Node.js 22.x, Framework Preset: Other.

Sign in at /staff/login. If something is wrong the site answers 503 with a message saying what to fix.
For unexpected errors add BOOT_DEBUG=1, redeploy, open /api/bootstrap, then remove it.

## Limits on Vercel
- Uploads are capped at ~4.5 MB per request.
- Background jobs (password-reset emails, payment reconciliation) run daily on the Hobby plan; change the schedule in vercel.json on Pro.
