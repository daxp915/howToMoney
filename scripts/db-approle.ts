// Creates the non-superuser role the app connects as, and writes
// APP_DATABASE_URL into .env.
//
//   npm run db:approle
//
// Why this exists: PostgreSQL superusers bypass row-level security entirely,
// even with FORCE ROW LEVEL SECURITY on the table. The Docker image's
// POSTGRES_USER is a superuser, so connecting as it would leave every tenant
// policy in place and enforcing nothing. This role is an ordinary one, and RLS
// applies to it.
//
// DATABASE_URL stays the superuser connection and is used for migrations and
// maintenance scripts. Idempotent: safe to re-run, and it never prints a secret.
import 'dotenv/config';
import crypto from 'node:crypto';
import postgres from 'postgres';
import * as env from './lib/envfile';

const ROLE = 'howtomoney_app';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL is not set');

function passwordFor(): { password: string; generated: boolean } {
  // In the container, .env is loaded as environment variables and the file
  // itself is not there to write to, so the password has to be supplied.
  const fromEnv = process.env.APP_DATABASE_PASSWORD?.trim();
  if (fromEnv) return { password: fromEnv, generated: false };

  const existing = env.exists() ? env.get('APP_DATABASE_PASSWORD') : '';
  if (existing) return { password: existing, generated: false };

  if (!env.exists()) {
    throw new Error(
      'APP_DATABASE_PASSWORD is not set and there is no .env to write one into. ' +
        'Set APP_DATABASE_PASSWORD in the environment and re-run.'
    );
  }

  const password = crypto.randomBytes(24).toString('base64url');
  env.set('APP_DATABASE_PASSWORD', password);
  return { password, generated: true };
}

const sql = postgres(adminUrl, { max: 1 });

async function main() {
  const { password, generated } = passwordFor();

  const [{ exists }] = await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = ${ROLE}) as exists
  `;

  if (exists) {
    await sql.unsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
    console.log(`role ${ROLE} already existed; password reset to the value in .env`);
  } else {
    await sql.unsafe(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
    console.log(`created role ${ROLE}`);
  }

  // Table privileges only -- no ownership, no DDL, no BYPASSRLS. The role can
  // read and write rows its policies allow and nothing else.
  const database = new URL(adminUrl).pathname.replace(/^\//, '');
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
  // Future migrations create tables as the superuser; without this the app role
  // would silently lack rights on anything added later.
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`
  );

  const url = new URL(adminUrl);
  url.username = ROLE;
  url.password = password;

  if (env.exists()) {
    env.set('APP_DATABASE_URL', url.toString());
    console.log(
      `granted privileges and wrote APP_DATABASE_URL to .env${generated ? ' (password generated)' : ''}`
    );
  } else {
    // Compose builds APP_DATABASE_URL from APP_DATABASE_PASSWORD, so there is
    // nothing to write back here.
    console.log('granted privileges; APP_DATABASE_URL comes from the environment');
  }
  console.log('the app now connects as a role that row-level security applies to');
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('failed:', e instanceof Error ? e.message : e);
    await sql.end();
    process.exit(1);
  });
