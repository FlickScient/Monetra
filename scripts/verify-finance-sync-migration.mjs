import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const connectionString=process.env.DATABASE_URL;
if(!connectionString){console.error('FAIL  DATABASE_URL is not configured.');process.exit(2);}
const pool=new Pool({connectionString});
const tables=['wallets','categories','transactions','ledger_accounts','ledger_entries','savings_goals','goal_allocations','goal_allocation_events','due_debts','due_debt_payments','monthly_budgets','recurring_transactions','wallet_reconciliations','finance_audit_events'];
try{
 const r=await pool.query(`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='sync_version' and data_type='bigint') workspace_cursor,to_regclass('public.finance_sync_changes') is not null change_log,exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capture_finance_sync_change') capture_function`);
 const s=r.rows[0]; if(!s.workspace_cursor||!s.change_log||!s.capture_function)throw new Error('Workspace cursor, change log, or capture function missing.');
 const tr=await pool.query(`select c.relname table_name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgname='finance_sync_change_trigger'`);
 const installed=new Set(tr.rows.map(x=>x.table_name)); const missing=tables.filter(x=>!installed.has(x));
 if(missing.length)throw new Error(`Missing finance sync triggers: ${missing.join(', ')}`);
 const ix=await pool.query(`select indexname from pg_indexes where schemaname='public' and indexname='finance_sync_changes_owner_cursor_idx'`);
 if(ix.rowCount!==1)throw new Error('Owner/cursor index missing.');
 console.log('PASS  Workspace sync_version is BIGINT; finance_sync_changes and capture function exist.');
 console.log(`PASS  All ${tables.length} finance-table triggers and owner/cursor index are installed.`);
 console.log('Read-only verification completed; no database changes were made.');
}catch(error){console.error(`FAIL  ${error instanceof Error?error.message:'Unknown verification error'}`);process.exitCode=1;}
finally{await pool.end();}
