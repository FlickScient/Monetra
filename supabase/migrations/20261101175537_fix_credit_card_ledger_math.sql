/*
# Correct credit-card liability accounting

1. Changes
- Add a unique partial index so each wallet has one wallet ledger account.
- Replace the posting function's balance updates for credit-card wallets.

2. Accounting behavior
- Asset wallet expenses reduce the wallet balance.
- Credit-card expenses increase the positive amount owed.
- Credit-card balances remain liabilities and are subtracted from net worth.
- Transfers between asset wallets remain net-worth neutral.

3. Security
- Preserve the existing authenticated-only execution grant.
- No user records are deleted or recreated.
*/

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_one_wallet_idx
ON public.ledger_accounts(user_id, wallet_id)
WHERE wallet_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_finance_transaction(
  p_transaction_type text,
  p_wallet_id uuid,
  p_amount_minor bigint,
  p_description text,
  p_category_id uuid DEFAULT NULL,
  p_destination_wallet_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_transaction_id uuid;
  v_source_account uuid;
  v_destination_account uuid;
  v_category_account uuid;
  v_wallet_type text;
  v_destination_type text;
BEGIN
  IF v_user_id IS NULL OR p_amount_minor <= 0 THEN RAISE EXCEPTION 'Invalid transaction'; END IF;
  SELECT wallet_type INTO v_wallet_type FROM public.wallets WHERE id = p_wallet_id AND user_id = v_user_id AND status = 'active';
  IF v_wallet_type IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF p_transaction_type = 'transfer' AND (p_destination_wallet_id IS NULL OR p_destination_wallet_id = p_wallet_id) THEN RAISE EXCEPTION 'Transfer destination required'; END IF;
  IF p_transaction_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_destination_wallet_id AND user_id = v_user_id AND status = 'active') THEN RAISE EXCEPTION 'Destination wallet not found'; END IF;
  SELECT wallet_type INTO v_destination_type FROM public.wallets WHERE id = p_destination_wallet_id AND user_id = v_user_id;

  INSERT INTO public.transactions (user_id, transaction_type, wallet_id, destination_wallet_id, category_id, amount_minor, description, occurred_at)
  VALUES (v_user_id, p_transaction_type, p_wallet_id, p_destination_wallet_id, p_category_id, p_amount_minor, p_description, p_occurred_at)
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.ledger_accounts (user_id, wallet_id, account_type, name)
  VALUES (v_user_id, p_wallet_id, CASE WHEN v_wallet_type = 'credit_card' THEN 'liability' ELSE 'asset' END, 'Wallet: ' || p_wallet_id::text)
  ON CONFLICT (user_id, wallet_id) WHERE wallet_id IS NOT NULL DO NOTHING;
  SELECT id INTO v_source_account FROM public.ledger_accounts WHERE wallet_id = p_wallet_id AND user_id = v_user_id;

  IF p_transaction_type = 'transfer' THEN
    INSERT INTO public.ledger_accounts (user_id, wallet_id, account_type, name)
    VALUES (v_user_id, p_destination_wallet_id, CASE WHEN v_destination_type = 'credit_card' THEN 'liability' ELSE 'asset' END, 'Wallet: ' || p_destination_wallet_id::text)
    ON CONFLICT (user_id, wallet_id) WHERE wallet_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_destination_account FROM public.ledger_accounts WHERE wallet_id = p_destination_wallet_id AND user_id = v_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_destination_account, p_amount_minor);
    INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
    UPDATE public.wallets SET current_balance_minor = current_balance_minor - p_amount_minor, updated_at = now() WHERE id = p_wallet_id AND wallet_type <> 'credit_card';
    UPDATE public.wallets SET current_balance_minor = current_balance_minor + p_amount_minor, updated_at = now() WHERE id = p_destination_wallet_id AND wallet_type <> 'credit_card';
    UPDATE public.wallets SET current_balance_minor = current_balance_minor - p_amount_minor, updated_at = now() WHERE id = p_wallet_id AND wallet_type = 'credit_card';
    UPDATE public.wallets SET current_balance_minor = current_balance_minor + p_amount_minor, updated_at = now() WHERE id = p_destination_wallet_id AND wallet_type = 'credit_card';
  ELSE
    INSERT INTO public.ledger_accounts (user_id, account_type, name) VALUES (v_user_id, CASE WHEN p_transaction_type IN ('income','refund') THEN 'income' ELSE 'expense' END, initcap(p_transaction_type)) RETURNING id INTO v_category_account;
    IF p_transaction_type IN ('income','refund') THEN
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_category_account, p_amount_minor);
      UPDATE public.wallets SET current_balance_minor = current_balance_minor + p_amount_minor, updated_at = now() WHERE id = p_wallet_id;
    ELSIF v_wallet_type = 'credit_card' THEN
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_category_account, p_amount_minor);
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
      UPDATE public.wallets SET current_balance_minor = current_balance_minor + p_amount_minor, updated_at = now() WHERE id = p_wallet_id;
    ELSE
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_category_account, p_amount_minor);
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
      UPDATE public.wallets SET current_balance_minor = current_balance_minor - p_amount_minor, updated_at = now() WHERE id = p_wallet_id;
    END IF;
  END IF;
  RETURN v_transaction_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_finance_transaction(text, uuid, bigint, text, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_finance_transaction(text, uuid, bigint, text, uuid, uuid, timestamptz) TO authenticated;
