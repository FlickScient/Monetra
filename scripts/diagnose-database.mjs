import { readFileSync, existsSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  const source = readFileSync('.env.local', 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env.DATABASE_URL = value;
    break;
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  DATABASE_URL is not available. Add it to .env.local or export it in this shell.');
  process.exit(2);
}

try {
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
} catch {
  console.error('FAIL  DATABASE_URL is malformed or does not use postgres:// or postgresql://.');
  process.exit(2);
}

const pool = new Pool({ connectionString });
const report = (label, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
const financeTables = [
  'wallets', 'categories', 'transactions', 'ledger_accounts', 'ledger_entries',
  'savings_goals', 'goal_allocations', 'goal_allocation_events', 'due_debts', 'due_debt_payments',
];

try {
  const connection = await pool.query('select current_database() as db, current_schema() as schema');
  report('Neon connection', true, `Connected to "${connection.rows[0].db}" (schema "${connection.rows[0].schema}")`);

  const required = ['workspaces', ...financeTables];
  const columns = await pool.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = current_schema() and table_name = any($1::text[])`,
    [required],
  );
  const actual = new Map();
  for (const row of columns.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }
  const missing = [];
  for (const table of required) {
    if (!actual.has(table)) missing.push(table);
    else if (table !== 'workspaces' && !actual.get(table).has('workspace_id')) missing.push(`${table}.workspace_id`);
  }
  for (const column of ['id', 'user_id', 'workspace_type', 'name']) {
    if (!actual.get('workspaces')?.has(column)) missing.push(`workspaces.${column}`);
  }
  report('Workspace-scoped finance schema', missing.length === 0,
    missing.length ? `Missing: ${missing.join(', ')}` : 'All finance tables contain workspace ownership');

  if (!missing.length) {
    const nullCounts = {};
    for (const table of financeTables) {
      const result = await pool.query(`select count(*)::int as count from ${table} where workspace_id is null`);
      nullCounts[table] = result.rows[0].count;
    }
    const nullTotal = Object.values(nullCounts).reduce((sum, value) => sum + value, 0);
    report('No unassigned finance records', nullTotal === 0, JSON.stringify(nullCounts));

    const workspaceCounts = await pool.query(
      `select workspace_type, count(*)::int as count from workspaces group by workspace_type order by workspace_type`,
    );
    report('Workspace types', workspaceCounts.rows.every(row => ['personal', 'family', 'business'].includes(row.workspace_type)),
      JSON.stringify(workspaceCounts.rows));

    const migrationTable = await pool.query(`select to_regclass('drizzle.__drizzle_migrations')::text as name`);
    if (!migrationTable.rows[0]?.name) {
      report('Drizzle migration history', false, 'History table is not created yet; run npm run db:migrate after reviewing the migration files');
    } else {
      const applied = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
      report('Drizzle migration history', true, `${applied.rows[0].count} migration record(s)`);
    }
  }

  if (missing.length) process.exitCode = 1;
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
  console.error(`FAIL  Database diagnostic — ${error instanceof Error ? error.message : 'Unknown error'} (code: ${code})`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
