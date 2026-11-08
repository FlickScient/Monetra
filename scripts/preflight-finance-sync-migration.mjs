import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  DATABASE_URL is not configured.');
  process.exit(2);
}

const pool = new Pool({ connectionString });
const syncTables = {
  wallets: ['id', 'workspace_id', 'user_id'],
  categories: ['id', 'workspace_id', 'user_id'],
  transactions: ['id', 'workspace_id', 'user_id'],
  ledger_accounts: ['id', 'workspace_id', 'user_id'],
  ledger_entries: ['id', 'workspace_id', 'user_id'],
  savings_goals: ['id', 'workspace_id', 'user_id'],
  goal_allocations: ['id', 'workspace_id', 'goal_id'],
  goal_allocation_events: ['id', 'workspace_id', 'user_id'],
  due_debts: ['id', 'workspace_id', 'user_id'],
  due_debt_payments: ['id', 'workspace_id', 'user_id'],
  monthly_budgets: ['id', 'workspace_id', 'user_id'],
  recurring_transactions: ['id', 'workspace_id', 'user_id'],
  wallet_reconciliations: ['id', 'workspace_id', 'user_id'],
  finance_audit_events: ['id', 'workspace_id', 'user_id'],
};

try {
  const identity = await pool.query(
    "select current_database() as database_name, current_schema() as schema_name",
  );
  if (identity.rows[0].schema_name !== 'public') {
    throw new Error('Expected public schema. Migration was NOT started.');
  }
  console.log(`Connected to "${identity.rows[0].database_name}" / public.`);

  const requiredTables = { ...syncTables, workspaces: ['id', 'user_id'] };
  const names = Object.keys(requiredTables);
  const columnsResult = await pool.query(
    `select table_name, column_name, udt_name
     from information_schema.columns
     where table_schema = 'public' and table_name = any($1::text[])`,
    [names],
  );
  const columns = new Map();
  for (const row of columnsResult.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map());
    columns.get(row.table_name).set(row.column_name, row.udt_name);
  }

  const missing = [];
  const badTypes = [];
  for (const [table, required] of Object.entries(requiredTables)) {
    if (!columns.has(table)) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of required) {
      if (!columns.get(table).has(column)) {
        missing.push(`${table}.${column}`);
        continue;
      }
      const actualType = columns.get(table).get(column);
      const expectedType = column === 'user_id' ? 'text' : 'uuid';
      if (actualType !== expectedType) {
        badTypes.push(`${table}.${column} expected ${expectedType}, got ${actualType}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`Sync source schema is incomplete: ${missing.join(', ')}. Migration was NOT started.`);
  }
  if (badTypes.length) {
    throw new Error(`Sync source columns have incompatible types: ${badTypes.join('; ')}. Migration was NOT started.`);
  }

  const workspaceNulls = await pool.query(
    `select count(*)::int as count
     from workspaces
     where id is null or user_id is null`,
  );
  if (workspaceNulls.rows[0].count > 0) {
    throw new Error('Workspace owner fields contain NULL values. Migration was NOT started.');
  }

  const ownerMismatch = await pool.query(
    `select
      (select count(*)::int from wallets x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as wallets,
      (select count(*)::int from categories x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as categories,
      (select count(*)::int from transactions x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as transactions,
      (select count(*)::int from ledger_accounts x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as ledger_accounts,
      (select count(*)::int from ledger_entries x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as ledger_entries,
      (select count(*)::int from savings_goals x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as savings_goals,
      (select count(*)::int from goal_allocations x left join workspaces w on w.id = x.workspace_id where w.id is null) as goal_allocations,
      (select count(*)::int from goal_allocation_events x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as goal_allocation_events,
      (select count(*)::int from due_debts x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as due_debts,
      (select count(*)::int from due_debt_payments x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as due_debt_payments,
      (select count(*)::int from monthly_budgets x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as monthly_budgets,
      (select count(*)::int from recurring_transactions x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as recurring_transactions,
      (select count(*)::int from wallet_reconciliations x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as wallet_reconciliations,
      (select count(*)::int from finance_audit_events x left join workspaces w on w.id = x.workspace_id where w.id is null or w.user_id <> x.user_id) as finance_audit_events`,
  );
  const mismatches = Object.entries(ownerMismatch.rows[0]).filter(([, count]) => Number(count) > 0);
  if (mismatches.length) {
    throw new Error(`Sync source rows have missing workspaces or owner mismatches: ${JSON.stringify(Object.fromEntries(mismatches))}. Migration was NOT started.`);
  }

  const orphanGoals = await pool.query(
    `select count(*)::int as count
     from goal_allocations a
     left join savings_goals g on g.id = a.goal_id and g.workspace_id = a.workspace_id
     where g.id is null`,
  );
  if (orphanGoals.rows[0].count > 0) {
    throw new Error(`${orphanGoals.rows[0].count} goal allocation(s) do not match a goal in the same workspace. Migration was NOT started.`);
  }

  console.log(`PASS  All ${Object.keys(syncTables).length} sync source tables and workspace ownership columns have the required UUID/text types.`);
  console.log('PASS  Workspace ownership matches every sync source row; goal allocations resolve through their workspace.');
  console.log('PASS  Existing source data is structurally compatible with migration 0008.');
  console.log('This is a read-only preflight. It does not apply or modify any migration.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : 'Unknown preflight error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
