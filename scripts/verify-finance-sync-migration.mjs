import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  DATABASE_URL is not configured.');
  process.exit(2);
}

const financeTables = [
  'wallets', 'categories', 'transactions', 'ledger_accounts',
  'ledger_entries', 'savings_goals', 'goal_allocations',
  'goal_allocation_events', 'due_debts', 'due_debt_payments',
  'monthly_budgets', 'recurring_transactions',
  'wallet_reconciliations', 'finance_audit_events',
];

const pool = new Pool({ connectionString });

try {
  const result = await pool.query(
    `select
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'workspaces'
           and column_name = 'sync_version' and data_type = 'bigint'
       ) as workspace_cursor,
       to_regclass('public.finance_sync_changes') is not null as change_log,
       exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'capture_finance_sync_change'
       ) as capture_function`,
  );
  const state = result.rows[0];
  if (!state.workspace_cursor || !state.change_log || !state.capture_function) {
    throw new Error('Workspace cursor, finance change log, or capture trigger function is missing.');
  }

  const triggers = await pool.query(
    `select c.relname as table_name, t.tgname
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not t.tgisinternal
       and t.tgname = 'finance_sync_change_trigger'`,
  );
  const installed = new Set(triggers.rows.map(row => row.table_name));
  const missing = financeTables.filter(table => !installed.has(table));
  if (missing.length) throw new Error(`Missing finance sync triggers: ${missing.join(', ')}`);

  const indexes = await pool.query(
    `select indexname from pg_indexes
     where schemaname = 'public' and indexname = 'finance_sync_changes_owner_cursor_idx'`,
  );
  if (indexes.rowCount !== 1) throw new Error('Finance sync owner/cursor index is missing.');

  console.log('PASS  Workspace sync_version is BIGINT and finance_sync_changes exists.');
  console.log(`PASS  Capture function and all ${financeTables.length} finance-table triggers are installed.`);
  console.log('PASS  Owner-scoped cursor index exists.');
  console.log('This verification is read-only; it does not apply or modify migrations.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : 'Unknown sync migration verification error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
