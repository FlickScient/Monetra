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
  v_transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
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
