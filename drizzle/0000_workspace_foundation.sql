CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  workspace_type text NOT NULL CHECK (workspace_type IN ('personal', 'family', 'business')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_user_type_unique UNIQUE (user_id, workspace_type)
);
--> statement-breakpoint
CREATE INDEX workspaces_user_idx ON workspaces(user_id);
--> statement-breakpoint
-- Build the three private workspaces directly from every existing Clerk owner.
-- Cast IDs to text so legacy UUID user IDs and current Clerk text IDs both map safely.
INSERT INTO workspaces (user_id, workspace_type, name)
SELECT users.user_id, types.workspace_type,
       CASE types.workspace_type
         WHEN 'personal' THEN 'Personal'
         WHEN 'family' THEN 'Family'
         ELSE 'Business'
       END
FROM (
  SELECT id::text AS user_id FROM profiles
  UNION SELECT user_id::text FROM wallets
  UNION SELECT user_id::text FROM categories
  UNION SELECT user_id::text FROM transactions
  UNION SELECT user_id::text FROM ledger_accounts
  UNION SELECT user_id::text FROM ledger_entries
) AS users
CROSS JOIN (VALUES ('personal'), ('family'), ('business')) AS types(workspace_type)
WHERE users.user_id IS NOT NULL
ON CONFLICT (user_id, workspace_type) DO NOTHING;
--> statement-breakpoint
-- Add workspace ownership without changing or deleting existing finance records.
ALTER TABLE wallets ADD COLUMN workspace_id uuid;
ALTER TABLE categories ADD COLUMN workspace_id uuid;
ALTER TABLE transactions ADD COLUMN workspace_id uuid;
ALTER TABLE ledger_accounts ADD COLUMN workspace_id uuid;
ALTER TABLE ledger_entries ADD COLUMN workspace_id uuid;
--> statement-breakpoint
-- All legacy records start in their owner's Personal workspace.
UPDATE wallets t SET workspace_id = w.id
FROM workspaces w WHERE w.user_id = t.user_id::text AND w.workspace_type = 'personal';
--> statement-breakpoint
UPDATE categories t SET workspace_id = w.id
FROM workspaces w WHERE w.user_id = t.user_id::text AND w.workspace_type = 'personal';
--> statement-breakpoint
UPDATE transactions t SET workspace_id = w.id
FROM workspaces w WHERE w.user_id = t.user_id::text AND w.workspace_type = 'personal';
--> statement-breakpoint
UPDATE ledger_accounts t SET workspace_id = w.id
FROM workspaces w WHERE w.user_id = t.user_id::text AND w.workspace_type = 'personal';
--> statement-breakpoint
UPDATE ledger_entries t SET workspace_id = w.id
FROM workspaces w WHERE w.user_id = t.user_id::text AND w.workspace_type = 'personal';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM categories WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM transactions WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM ledger_accounts WHERE workspace_id IS NULL)
    OR EXISTS (SELECT 1 FROM ledger_entries WHERE workspace_id IS NULL)
  THEN
    RAISE EXCEPTION 'Workspace foundation stopped: one or more existing finance rows could not be mapped to an owner Personal workspace.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE wallets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE ledger_accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE wallets ADD CONSTRAINT wallets_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE categories ADD CONSTRAINT categories_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
--> statement-breakpoint
CREATE INDEX wallets_workspace_idx ON wallets(workspace_id);
CREATE INDEX categories_workspace_idx ON categories(workspace_id);
CREATE INDEX transactions_workspace_date_idx ON transactions(workspace_id, occurred_at);
CREATE INDEX ledger_accounts_workspace_idx ON ledger_accounts(workspace_id);
CREATE INDEX ledger_entries_workspace_idx ON ledger_entries(workspace_id);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);
