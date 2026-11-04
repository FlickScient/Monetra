-- Add parallel workspace ownership columns first; keep legacy organization_id
-- columns during rollout so this migration is reversible and old data is preserved.
ALTER TABLE wallets ADD COLUMN workspace_id uuid;
ALTER TABLE categories ADD COLUMN workspace_id uuid;
ALTER TABLE transactions ADD COLUMN workspace_id uuid;
ALTER TABLE ledger_accounts ADD COLUMN workspace_id uuid;
ALTER TABLE ledger_entries ADD COLUMN workspace_id uuid;
ALTER TABLE savings_goals ADD COLUMN workspace_id uuid;
ALTER TABLE goal_allocations ADD COLUMN workspace_id uuid;
ALTER TABLE goal_allocation_events ADD COLUMN workspace_id uuid;
ALTER TABLE due_debts ADD COLUMN workspace_id uuid;
ALTER TABLE due_debt_payments ADD COLUMN workspace_id uuid;
--> statement-breakpoint
-- Resolve each legacy organization to the matching owner/type workspace.
UPDATE wallets t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE categories t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE transactions t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE ledger_accounts t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE ledger_entries t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE savings_goals t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE goal_allocations t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE goal_allocation_events t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE due_debts t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
UPDATE due_debt_payments t SET workspace_id = w.id FROM organizations o JOIN workspaces w
  ON w.user_id = o.created_by AND w.workspace_type = o.organization_type
  WHERE t.organization_id = o.id;
--> statement-breakpoint
-- Fail safely instead of assigning ambiguous/orphaned records to an arbitrary user.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM categories WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM transactions WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM ledger_accounts WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM ledger_entries WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM savings_goals WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM goal_allocations WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM goal_allocation_events WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM due_debts WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM due_debt_payments WHERE workspace_id IS NULL)
  THEN RAISE EXCEPTION 'Workspace migration stopped: one or more finance rows could not be mapped to an owner workspace'; END IF;
END $$;
--> statement-breakpoint
ALTER TABLE wallets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE ledger_accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE savings_goals ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE goal_allocations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE goal_allocation_events ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE due_debts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE due_debt_payments ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE wallets ADD CONSTRAINT wallets_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE categories ADD CONSTRAINT categories_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE savings_goals ADD CONSTRAINT savings_goals_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE goal_allocations ADD CONSTRAINT goal_allocations_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE goal_allocation_events ADD CONSTRAINT goal_allocation_events_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE due_debts ADD CONSTRAINT due_debts_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE due_debt_payments ADD CONSTRAINT due_debt_payments_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
--> statement-breakpoint
CREATE INDEX wallets_workspace_idx ON wallets(workspace_id);
CREATE INDEX categories_workspace_idx ON categories(workspace_id);
CREATE INDEX transactions_workspace_date_idx ON transactions(workspace_id, occurred_at);
CREATE INDEX ledger_accounts_workspace_idx ON ledger_accounts(workspace_id);
CREATE INDEX ledger_entries_workspace_idx ON ledger_entries(workspace_id);
CREATE INDEX savings_goals_workspace_idx ON savings_goals(workspace_id, created_at);
CREATE INDEX goal_allocations_workspace_idx ON goal_allocations(workspace_id);
CREATE INDEX goal_allocation_events_workspace_idx ON goal_allocation_events(workspace_id, created_at);
CREATE INDEX due_debts_workspace_idx ON due_debts(workspace_id, created_at);
CREATE INDEX due_debt_payments_workspace_idx ON due_debt_payments(workspace_id, created_at);
