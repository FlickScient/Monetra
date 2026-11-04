-- Protect the journal's account identity and transaction retry semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_accounts
    WHERE wallet_id IS NOT NULL
    GROUP BY workspace_id, wallet_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ledger integrity migration stopped: duplicate wallet ledger accounts exist. Reconcile these accounts before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ledger_accounts la
    JOIN wallets w ON w.id = la.wallet_id
    WHERE la.workspace_id <> w.workspace_id
  ) THEN
    RAISE EXCEPTION 'Ledger integrity migration stopped: a wallet ledger account belongs to a different workspace than its wallet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ledger_entries le
    JOIN transactions t ON t.id = le.transaction_id
    JOIN ledger_accounts la ON la.id = le.ledger_account_id
    WHERE le.workspace_id <> t.workspace_id
       OR le.workspace_id <> la.workspace_id
  ) THEN
    RAISE EXCEPTION 'Ledger integrity migration stopped: a journal line crosses workspace boundaries.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    WHERE t.workspace_id <> w.workspace_id
  ) OR EXISTS (
    SELECT 1 FROM transactions t
    JOIN wallets w ON w.id = t.destination_wallet_id
    WHERE t.workspace_id <> w.workspace_id
  ) OR EXISTS (
    SELECT 1 FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.workspace_id <> c.workspace_id
  ) THEN
    RAISE EXCEPTION 'Ledger integrity migration stopped: a transaction references finance data in another workspace.';
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
    RAISE EXCEPTION 'Ledger integrity migration stopped: a goal or debt record crosses workspace boundaries.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE NOT (
      (debit_minor > 0 AND credit_minor = 0)
      OR (credit_minor > 0 AND debit_minor = 0)
    )
  ) THEN
    RAISE EXCEPTION 'Ledger integrity migration stopped: existing journal lines are not one-sided positive entries.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_entries_one_side_check'
      AND conrelid = 'ledger_entries'::regclass
  ) THEN
    ALTER TABLE ledger_entries
      ADD CONSTRAINT ledger_entries_one_side_check
      CHECK (
        (debit_minor > 0 AND credit_minor = 0)
        OR (credit_minor > 0 AND debit_minor = 0)
      );
  END IF;
END $$;
--> statement-breakpoint
UPDATE ledger_accounts la
SET account_type = CASE WHEN w.wallet_type = 'credit_card' THEN 'liability' ELSE 'asset' END
FROM wallets w
WHERE la.wallet_id = w.id
  AND la.workspace_id = w.workspace_id
  AND la.account_type IN ('asset', 'liability');
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_accounts_workspace_wallet_unique
  ON ledger_accounts(workspace_id, wallet_id)
  WHERE wallet_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN idempotency_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX transactions_workspace_idempotency_unique
  ON transactions(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_ledger_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_id uuid;
  v_debits numeric;
  v_credits numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_transaction_id := OLD.transaction_id;
  ELSE
    v_transaction_id := NEW.transaction_id;
  END IF;
  SELECT COALESCE(sum(debit_minor), 0), COALESCE(sum(credit_minor), 0)
    INTO v_debits, v_credits
    FROM ledger_entries
    WHERE transaction_id = v_transaction_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Unbalanced ledger transaction %: debits %, credits %',
      v_transaction_id, v_debits, v_credits;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_ledger_transaction_balanced();
