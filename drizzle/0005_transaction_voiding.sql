ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_workspace_active_date_idx ON transactions(workspace_id, occurred_at DESC) WHERE voided_at IS NULL;
