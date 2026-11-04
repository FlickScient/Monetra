import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  DATABASE_URL is not configured.');
  process.exit(2);
}

const pool = new Pool({ connectionString });
const required = {
  profiles: ['id'],
  wallets: ['id', 'user_id', 'occurred_at'],
  categories: ['id', 'user_id'],
  transactions: ['id', 'user_id', 'occurred_at'],
  ledger_accounts: ['id', 'user_id'],
  ledger_entries: ['id', 'user_id', 'transaction_id'],
};

try {
  const identity = await pool.query(
    "select current_database() as database_name, current_schema() as schema_name, current_setting('search_path') as search_path",
  );
  console.log(`Connected to database "${identity.rows[0].database_name}" / schema "${identity.rows[0].schema_name}".`);

  const result = await pool.query(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = current_schema()
       and table_name = any($1::text[])`,
    [Object.keys(required)],
  );
  const actual = new Map();
  for (const row of result.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  const missing = [];
  for (const [table, columns] of Object.entries(required)) {
    if (!actual.has(table)) missing.push(`${table} (table)`);
    for (const column of columns) {
      if (!actual.get(table)?.has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length) {
    throw new Error(`Unexpected starting schema; missing ${missing.join(', ')}. Migration was NOT started.`);
  }

  const unexpected = await pool.query(
    `select table_schema, table_name
     from information_schema.tables
     where table_schema = current_schema()
       and table_name = any($1::text[])`,
    [['organizations', 'organization_members', 'invitations', 'workspaces',
      'savings_goals', 'goal_allocations', 'goal_allocation_events', 'due_debts', 'due_debt_payments']],
  );
  if (unexpected.rowCount) {
    throw new Error(`Partial target schema already exists (${unexpected.rows.map(r => r.table_name).join(', ')}). Migration was NOT started.`);
  }

  const history = await pool.query(
    "select to_regclass('drizzle.__drizzle_migrations')::text as migration_table",
  );
  if (history.rows[0]?.migration_table) {
    throw new Error('Drizzle migration history already exists. This workflow expects a fresh migration baseline and will NOT run.');
  }

  console.log('PASS  Starting schema matches the reviewed legacy finance baseline.');
  console.log('PASS  No partial workspace schema or Drizzle migration history exists.');
  console.log('Preflight passed. Safe to proceed with the reviewed migration chain.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : 'Unknown preflight error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
