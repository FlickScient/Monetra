CREATE SEQUENCE IF NOT EXISTS finance_sync_cursor_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS finance_sync_changes (
  cursor BIGINT PRIMARY KEY DEFAULT nextval('finance_sync_cursor_seq'),
  workspace_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_sync_changes_payload_check CHECK (
    (operation = 'upsert' AND payload IS NOT NULL) OR
    (operation = 'delete' AND payload IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS finance_sync_changes_owner_cursor_idx
  ON finance_sync_changes (user_id, workspace_id, cursor);

CREATE OR REPLACE FUNCTION capture_finance_sync_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_data JSONB;
  row_workspace_id UUID;
  row_user_id TEXT;
  row_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;

  row_workspace_id := (row_data ->> 'workspace_id')::UUID;
  row_id := (row_data ->> 'id')::UUID;

  IF row_workspace_id IS NULL OR row_id IS NULL THEN
    RAISE EXCEPTION 'Finance sync trigger requires workspace_id and id on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  row_user_id := NULLIF(row_data ->> 'user_id', '');
  IF row_user_id IS NULL THEN
    SELECT w.user_id INTO row_user_id
      FROM workspaces w
      WHERE w.id = row_workspace_id;
  END IF;

  IF row_user_id IS NULL THEN
    RAISE EXCEPTION 'Finance sync trigger could not resolve workspace owner for %', row_workspace_id;
  END IF;

  INSERT INTO finance_sync_changes (
    workspace_id, user_id, entity_type, entity_id, operation, payload
  ) VALUES (
    row_workspace_id,
    row_user_id,
    TG_TABLE_NAME,
    row_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_data END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
  finance_tables TEXT[] := ARRAY[
    'wallets',
    'categories',
    'transactions',
    'ledger_accounts',
    'ledger_entries',
    'savings_goals',
    'goal_allocations',
    'goal_allocation_events',
    'due_debts',
    'due_debt_payments',
    'monthly_budgets',
    'recurring_transactions',
    'wallet_reconciliations',
    'finance_audit_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY finance_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS finance_sync_change_trigger ON %I', table_name);
    EXECUTE format(
      'CREATE TRIGGER finance_sync_change_trigger AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_finance_sync_change()',
      table_name
    );
  END LOOP;
END;
$$;
