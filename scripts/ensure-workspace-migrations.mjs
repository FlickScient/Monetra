import { spawnSync } from 'node:child_process';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// GitHub CI validates application code only. It must not require a database
// secret or connect to any user database during a pull-request build.
if (process.env.MONETRA_CI_BUILD === '1') {
  console.log('WORKSPACE_MIGRATION: skipped in CI; database checks run only against the isolated QA branch.');
  process.exit(0);
}

// Vercel Preview deployments must never run schema migrations. Preview
// DATABASE_URL values can point at production when no isolated preview DB is
// configured, so keep previews build-only and leave all database changes to an
// explicitly controlled migration step.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('WORKSPACE_MIGRATION: skipped for Vercel Preview; no database changes will run.');
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('WORKSPACE_MIGRATION: DATABASE_URL is missing from this Vercel build environment.');
  process.exit(2);
}

const pool = new Pool({ connectionString });

function runNpmScript(script) {
  console.log(`\nWORKSPACE_MIGRATION: running npm run ${script}`);
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

try {
  const state = await pool.query(`
    select
      to_regclass('public.workspaces')::text as workspaces_table,
      to_regclass('drizzle.__drizzle_migrations')::text as migration_table
  `);

  const { workspaces_table, migration_table } = state.rows[0];

  if (workspaces_table && migration_table) {
    console.log('WORKSPACE_MIGRATION: migration history exists; applying any pending migrations before verification.');
    await pool.end();
    runNpmScript('db:migrate');
    runNpmScript('db:verify:workspace');
    console.log('WORKSPACE_MIGRATION: database migrations are current and verified.');
    process.exit(0);
  }

  console.log('WORKSPACE_MIGRATION: legacy baseline detected; running read-only preflight before applying migrations.');
  await pool.end();
  runNpmScript('db:preflight:workspace');
  runNpmScript('db:migrate');
  runNpmScript('db:verify:workspace');
  console.log('WORKSPACE_MIGRATION: migrations applied and verified successfully.');
} catch (error) {
  try { await pool.end(); } catch {}
  console.error(`WORKSPACE_MIGRATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
}
