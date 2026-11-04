// Vercel serverless entry point for the TVET portal (Supabase-only deployment).
// On first request this file connects to Supabase and, automatically:
//   1. creates/updates all database tables (migrations, safe to repeat),
//   2. creates the private storage bucket if it does not exist,
//   3. creates the first super admin if ADMIN_EMAIL + ADMIN_PASSWORD + ADMIN_PHONE are set
//      and no super admin exists yet.
// All catalogue content is then read live from Supabase. src/server.js is unchanged (local/Docker).

class ConfigError extends Error {}

const REQUIRED = ['DATABASE_URL', 'APP_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
let booting;

function friendlyDbError(e) {
  const code = e && e.code;
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))
    return new ConfigError('Database SSL certificate is not trusted. In Vercel set DATABASE_SSL=no-verify (quick fix) or PG_CA_CERT to the Supabase certificate.');
  if (code === '28P01') return new ConfigError('Supabase rejected the database password. Check the password inside DATABASE_URL.');
  if (code === 'ENOTFOUND') return new ConfigError('Database host not found. Check DATABASE_URL (copy the Transaction pooler string from Supabase > Connect).');
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return new ConfigError('Could not reach the database. Use the Supabase Transaction pooler string (port 6543) for DATABASE_URL.');
  if (code === 'XX000' && /tenant|user not found/i.test(String(e.message))) return new ConfigError('Supabase pooler says the user was not found. DATABASE_URL must use the pooler username (postgres.<project-ref>).');
  return e;
}

async function ensureSchema(db, migrate) {
  const applied = async () => {
    try {
      return (await db.query('SELECT 1 FROM schema_migrations WHERE version=$1', ['004_admin_subscriptions.sql'])).rows.length > 0;
    } catch (e) {
      if (e.code === '42P01') return false; // table does not exist yet
      throw e;
    }
  };
  if (await applied()) return;
  // One instance migrates at a time; others wait on the lock, then see it is done.
  await db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(727274)');
    if (!(await applied())) await migrate(db);
  });
  console.log(JSON.stringify({ level: 'info', msg: 'database_migrated' }));
}

async function ensureBucket() {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const name = process.env.STORAGE_BUCKET || 'papers';
    const { data } = await sb.storage.getBucket(name);
    if (!data) {
      const { error } = await sb.storage.createBucket(name, { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
      console.log(JSON.stringify({ level: 'info', msg: 'storage_bucket_created', bucket: name }));
    }
  } catch (e) {
    // Not fatal: browsing still works; uploads will report a storage error.
    console.error('STORAGE_BUCKET_CHECK_FAILED', e && e.message);
  }
}

async function ensureAdmin(db) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PHONE, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_PHONE) return;
  try {
    if ((await db.query("SELECT 1 FROM users WHERE role='super_admin' LIMIT 1")).rows.length) return;
    const { identity, password } = await import('../src/auth.js');
    const { id, hashPassword, audit } = await import('../src/util.js');
    const profile = identity({ name: ADMIN_NAME || 'Administrator', email: ADMIN_EMAIL, phone: ADMIN_PHONE });
    const hash = await hashPassword(password(ADMIN_PASSWORD));
    const uid = id();
    await db.tx(async (t) => {
      await t.query("INSERT INTO users(id,name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,'super_admin')", [uid, profile.name, profile.email, profile.phone, hash]);
      await audit(t, uid, 'super_admin.bootstrapped', uid);
    });
    console.log(JSON.stringify({ level: 'info', msg: 'super_admin_created' }));
  } catch (e) {
    if (e && e.code === '23505') return; // another instance created it
    console.error('ADMIN_BOOTSTRAP_FAILED', e && e.message); // not fatal
  }
}

async function boot() {
  process.env.TRUST_PROXY ||= '1'; // Vercel sits behind one proxy
  const missing = REQUIRED.filter((n) => !process.env[n]);
  if (missing.length) throw new ConfigError('Missing environment variables: ' + missing.join(', '));
  if (!process.env.APP_URL.startsWith('https://')) throw new ConfigError('APP_URL must start with https://');

  const { openDb, migrate } = await import('../src/db.js');
  const { storage } = await import('../src/services/storage.js');
  const { Pesapal } = await import('../src/services/pesapal.js');
  const { createApp } = await import('../src/app.js');
  const { runJobs } = await import('../src/jobs.js');

  const db = await openDb();
  try {
    await db.query('SELECT 1');
    await ensureSchema(db, migrate);
  } catch (e) {
    throw friendlyDbError(e);
  }
  await ensureBucket();
  await ensureAdmin(db);

  const app = createApp({ db, files: storage(), provider: new Pesapal() });
  return { app, db, runJobs, Pesapal };
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  let ctx;
  try {
    ctx = await (booting ??= boot());
  } catch (e) {
    booting = undefined; // retry on next request
    console.error('BOOT_ERROR', e && e.stack ? e.stack : e);
    const config = e instanceof ConfigError;
    return send(res, 503, {
      error: config ? e.message : 'The service failed to start.',
      ...(!config && process.env.BOOT_DEBUG === '1' ? { detail: String(e && e.message), name: e && e.name, code: e && e.code } : {}),
    });
  }

  // Scheduled background jobs (emails, payment reconciliation). Vercel Cron calls this daily.
  if (req.url.split('?')[0] === '/api/cron/jobs') {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== 'Bearer ' + secret) return send(res, 401, { error: 'Unauthorized' });
    try {
      return send(res, 200, await ctx.runJobs(ctx.db, new ctx.Pesapal()));
    } catch (e) {
      console.error('CRON_JOBS_ERROR', e && e.stack ? e.stack : e);
      return send(res, 500, { error: 'Job run failed' });
    }
  }

  return ctx.app(req, res);
}
