-- Validate direct workspace ownership before ledger-integrity constraints are installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM categories t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM transactions t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM ledger_accounts t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM ledger_entries t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM savings_goals t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM goal_allocation_events t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM due_debts t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
    OR EXISTS (SELECT 1 FROM due_debt_payments t JOIN workspaces w ON w.id = t.workspace_id WHERE w.user_id <> t.user_id::text)
  THEN
    RAISE EXCEPTION 'Workspace ownership check failed: a finance record is assigned to a workspace owned by another user.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM goal_allocations a
    JOIN savings_goals g ON g.id = a.goal_id
    JOIN wallets w ON w.id = a.wallet_id
    WHERE a.workspace_id <> g.workspace_id OR a.workspace_id <> w.workspace_id
  ) OR EXISTS (
    SELECT 1 FROM goal_allocation_events e
    JOIN savings_goals g ON g.id = e.goal_id
    JOIN wallets w ON w.id = e.wallet_id
    WHERE e.workspace_id <> g.workspace_id OR e.workspace_id <> w.workspace_id
  ) OR EXISTS (
    SELECT 1 FROM due_debt_payments p
    JOIN due_debts d ON d.id = p.due_debt_id
    WHERE p.workspace_id <> d.workspace_id
  ) THEN
    RAISE EXCEPTION 'Workspace ownership check failed: a goal or debt record crosses workspace boundaries.';
  END IF;
END $$;
