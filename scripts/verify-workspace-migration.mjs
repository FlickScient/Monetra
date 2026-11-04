import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const pool = new Pool({ connectionString });
const requiredTables = [
  'profiles', 'wallets', 'categories', 'transactions', 'ledger_accounts',
  'ledger_entries', 'workspaces', 'savings_goals', 'goal_allocations', 'goal_allocation_events',
  'due_debts', 'due_debt_payments',
];

try {
  const tables = await pool.query(
    `select table_name from information_schema.tables
     where table_schema = current_schema() and table_type = 'BASE TABLE'
       and table_name = any($1::text[])`,
    [requiredTables],
  );
  const found = new Set(tables.rows.map(row => row.table_name));
  const missing = requiredTables.filter(name => !found.has(name));
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);

  const financeTables = [
    'wallets', 'categories', 'transactions', 'ledger_accounts', 'ledger_entries',
    'savings_goals', 'goal_allocations', 'goal_allocation_events', 'due_debts', 'due_debt_payments',
  ];
  const columns = await pool.query(
    `select table_name, column_name, is_nullable
     from information_schema.columns
     where table_schema = current_schema()
       and table_name = any($1::text[])
       and column_name = 'workspace_id'`,
    [financeTables],
  );
  const byTable = new Map(columns.rows.map(row => [row.table_name, row]));
  const invalid = financeTables.filter(name => !byTable.has(name) || byTable.get(name).is_nullable !== 'NO');
  const transactionColumns = await pool.query("select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'transactions' and column_name = 'idempotency_key'");
  if (transactionColumns.rowCount !== 1) invalid.push('transactions.idempotency_key');
  if (invalid.length) throw new Error(`workspace_id missing or nullable on: ${invalid.join(', ')}`);

  const ledgerIntegrity = await pool.query(
    `select
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'ledger_accounts_workspace_wallet_unique') as wallet_account_unique,
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'transactions_workspace_idempotency_unique') as transaction_idempotency_unique,
       exists (select 1 from pg_constraint where conname = 'ledger_entries_one_side_check' and conrelid = 'ledger_entries'::regclass) as journal_line_one_side_check,
       exists (select 1 from pg_trigger where tgname = 'ledger_transaction_balanced' and not tgisinternal) as balanced_journal_trigger`,
  );
  const integrity = ledgerIntegrity.rows[0];
  if (!integrity.wallet_account_unique || !integrity.transaction_idempotency_unique || !integrity.journal_line_one_side_check || !integrity.balanced_journal_trigger) {
    throw new Error('Ledger integrity indexes or deferred balanced-journal trigger are missing.');
  }

  const ownership = await pool.query(
    `with owners as (
       select id::text as user_id from profiles
       union select user_id::text from wallets
       union select user_id::text from categories
       union select user_id::text from transactions
       union select user_id::text from ledger_accounts
       union select user_id::text from ledger_entries
     )
     select
       (select count(*)::int from owners) as owners,
       (select count(*)::int from workspaces) as workspaces,
       (select count(*)::int from owners o
         where (select count(*) from workspaces w where w.user_id = o.user_id) <> 3) as incomplete_users,
       (select count(*)::int from workspaces w
         where not exists (select 1 from owners o where o.user_id = w.user_id)) as workspaces_without_finance_owner
     from (select 1) seed`,
  );
  const row = ownership.rows[0];
  if (row.incomplete_users !== 0 || row.workspaces_without_finance_owner !== 0 || row.workspaces !== row.owners * 3) {
    throw new Error(`Workspace ownership mismatch: ${JSON.stringify(row)}. Each existing owner must have exactly three private workspaces.`);
  }

  const history = await pool.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );
  if (history.rows[0].count < 5) {
    throw new Error(`Expected at least five recorded migrations; found ${history.rows[0].count}.`);
  }

  console.log('PASS  All required finance and workspace tables exist.');
  console.log('PASS  Every finance table has NOT NULL workspace_id.');
  console.log('PASS  Wallet ledger uniqueness, transaction idempotency, and balanced-journal trigger exist.');
  console.log(`PASS  ${row.owners} existing finance owner(s), ${row.workspaces} workspace(s); every owner has exactly three private workspaces.`);
  console.log(`PASS  Drizzle recorded ${history.rows[0].count} migrations.`);
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : 'Unknown verification error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
