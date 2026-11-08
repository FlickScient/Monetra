CREATE TABLE IF NOT EXISTS monthly_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  limit_minor bigint NOT NULL CHECK (limit_minor > 0),
  carry_forward boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT monthly_budgets_category_month_unique UNIQUE (workspace_id, category_id, month_start)
);
CREATE INDEX IF NOT EXISTS monthly_budgets_workspace_month_idx ON monthly_budgets(workspace_id, month_start);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  next_run date NOT NULL,
  last_generated_for date,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_transactions_workspace_next_run_idx ON recurring_transactions(workspace_id, next_run);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS wallet_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  recorded_minor bigint NOT NULL,
  actual_minor bigint NOT NULL,
  variance_minor bigint NOT NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_reconciliations_workspace_created_idx ON wallet_reconciliations(workspace_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finance_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  summary text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_audit_events_workspace_created_idx ON finance_audit_events(workspace_id, created_at);
