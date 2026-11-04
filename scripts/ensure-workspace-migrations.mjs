import { spawnSync } from 'node:child_process';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

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
    const history = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
    if (history.rows[0].count >= 5) {
      console.log('WORKSPACE_MIGRATION: migration history exists; verifying the deployed database.');
      await pool.end();
      runNpmScript('db:verify:workspace');
      console.log('WORKSPACE_MIGRATION: database is already migrated and verified.');
      process.exit(0);
    }
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
