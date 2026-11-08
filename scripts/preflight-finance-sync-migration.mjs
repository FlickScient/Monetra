import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('FAIL  DATABASE_URL is not configured.'); process.exit(2); }
const pool = new Pool({ connectionString });
const syncTables = {
  wallets: ['id','workspace_id','user_id'], categories: ['id','workspace_id','user_id'],
  transactions: ['id','workspace_id','user_id'], ledger_accounts: ['id','workspace_id','user_id'],
  ledger_entries: ['id','workspace_id','user_id'], savings_goals: ['id','workspace_id','user_id'],
  goal_allocations: ['id','workspace_id','goal_id'], goal_allocation_events: ['id','workspace_id','user_id'],
  due_debts: ['id','workspace_id','user_id'], due_debt_payments: ['id','workspace_id','user_id'],
  monthly_budgets: ['id','workspace_id','user_id'], recurring_transactions: ['id','workspace_id','user_id'],
  wallet_reconciliations: ['id','workspace_id','user_id'], finance_audit_events: ['id','workspace_id','user_id'],
};
try {
  const identity = await pool.query("select current_database() as database_name, current_schema() as schema_name");
  if (identity.rows[0].schema_name !== 'public') throw new Error('Expected public schema.');
  console.log(`Connected to "${identity.rows[0].database_name}" / public (read-only preflight).`);
  const required = { ...syncTables, workspaces: ['id','user_id'] };
  const names = Object.keys(required);
  const result = await pool.query(`select table_name,column_name,udt_name from information_schema.columns where table_schema='public' and table_name=any($1::text[])`,[names]);
  const columns = new Map();
  for (const row of result.rows) { if (!columns.has(row.table_name)) columns.set(row.table_name,new Map()); columns.get(row.table_name).set(row.column_name,row.udt_name); }
  const issues=[];
  for (const [table,cols] of Object.entries(required)) {
    if (!columns.has(table)) { issues.push(`${table} (table missing)`); continue; }
    for (const col of cols) {
      const actual=columns.get(table).get(col);
      if (!actual) issues.push(`${table}.${col} missing`);
      else if (actual !== (col==='user_id'?'text':'uuid')) issues.push(`${table}.${col} expected ${col==='user_id'?'text':'uuid'}, got ${actual}`);
    }
  }
  if (issues.length) throw new Error(issues.join('; '));
  const mismatches=await pool.query(`select
    (select count(*)::int from wallets x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) wallets,
    (select count(*)::int from categories x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) categories,
    (select count(*)::int from transactions x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) transactions,
    (select count(*)::int from ledger_accounts x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) ledger_accounts,
    (select count(*)::int from ledger_entries x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) ledger_entries,
    (select count(*)::int from savings_goals x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) savings_goals,
    (select count(*)::int from goal_allocations x left join workspaces w on w.id=x.workspace_id where w.id is null) goal_allocations,
    (select count(*)::int from goal_allocation_events x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) goal_allocation_events,
    (select count(*)::int from due_debts x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) due_debts,
    (select count(*)::int from due_debt_payments x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) due_debt_payments,
    (select count(*)::int from monthly_budgets x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) monthly_budgets,
    (select count(*)::int from recurring_transactions x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) recurring_transactions,
    (select count(*)::int from wallet_reconciliations x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) wallet_reconciliations,
    (select count(*)::int from finance_audit_events x left join workspaces w on w.id=x.workspace_id where w.id is null or w.user_id<>x.user_id) finance_audit_events`);
  const bad=Object.entries(mismatches.rows[0]).filter(([,v])=>Number(v)>0);
  if (bad.length) throw new Error(`Owner/workspace mismatch: ${JSON.stringify(Object.fromEntries(bad))}`);
  const orphan=await pool.query(`select count(*)::int as count from goal_allocations a left join savings_goals g on g.id=a.goal_id and g.workspace_id=a.workspace_id where g.id is null`);
  if (orphan.rows[0].count>0) throw new Error(`${orphan.rows[0].count} orphan goal allocations`);
  console.log(`PASS  All ${Object.keys(syncTables).length} sync source tables have compatible IDs and ownership.`);
  console.log('PASS  Existing finance rows match workspace ownership; no data was changed.');
} catch(error) { console.error(`FAIL  ${error instanceof Error?error.message:'Unknown preflight error'}`); process.exitCode=1; }
finally { await pool.end(); }
