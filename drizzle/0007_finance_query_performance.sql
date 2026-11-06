CREATE INDEX IF NOT EXISTS ledger_entries_workspace_account_idx
  ON ledger_entries (workspace_id, ledger_account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_workspace_user_active_date_idx
  ON transactions (workspace_id, user_id, occurred_at DESC)
  WHERE voided_at IS NULL;
