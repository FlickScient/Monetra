import { spawnSync } from 'node:child_process';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// GitHub CI must validate the Next.js build without connecting to or mutating
// the user's finance database. Vercel builds do not set this CI-only flag.
if (process.env.MONETRA_CI_BUILD === '1') {
  console.log('WORKSPACE_MIGRATION: skipped for isolated CI build; no database was contacted.');
  process.exit(0);
}

// Preview deployments share DATABASE_URL with production in this project.
// Never allow a feature-branch preview build to apply database migrations.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('WORKSPACE_MIGRATION: running read-only sync schema verification on preview; no migration will be applied.');
  runNpmScript('db:verify:sync');
  console.log('WORKSPACE_MIGRATION: preview schema verification passed; no database mutation performed.');
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
    runNpmScript('db:verify:sync');
    console.log('WORKSPACE_MIGRATION: database migrations are current and verified.');
    process.exit(0);
  }

  console.log('WORKSPACE_MIGRATION: legacy baseline detected; running read-only preflight before applying migrations.');
  await pool.end();
  runNpmScript('db:preflight:workspace');
  runNpmScript('db:migrate');
  runNpmScript('db:verify:workspace');
  runNpmScript('db:verify:sync');
  console.log('WORKSPACE_MIGRATION: migrations applied and verified successfully.');
} catch (error) {
  try { await pool.end(); } catch {}
  console.error(`WORKSPACE_MIGRATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
}
