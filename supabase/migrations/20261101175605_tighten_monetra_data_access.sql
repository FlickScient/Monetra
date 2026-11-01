/*
# Tighten MoneTra data access

1. Security changes
- Remove anonymous Data API access from all private finance tables.
- Restrict wallet writes so balances and ownership cannot be changed by the browser.
- Keep ledger and transaction writes inside server-side functions.
- Add an authenticated wallet-creation function that initializes the opening balance atomically.

2. Important notes
- Existing rows remain unchanged.
- Authenticated users retain access only to their own records.
*/

REVOKE ALL ON public.profiles, public.wallets, public.categories, public.transactions, public.ledger_accounts, public.ledger_entries FROM anon;
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT (id, display_name, currency), UPDATE (display_name, currency) ON public.profiles TO authenticated;
REVOKE INSERT, UPDATE ON public.wallets FROM authenticated;
GRANT INSERT (name, wallet_type, currency, opening_balance_minor, credit_limit_minor, status, notes) ON public.wallets TO authenticated;
GRANT UPDATE (name, wallet_type, currency, credit_limit_minor, status, notes) ON public.wallets TO authenticated;

CREATE OR REPLACE FUNCTION public.create_wallet(
  p_name text,
  p_wallet_type text,
  p_currency text,
  p_opening_balance_minor bigint,
  p_credit_limit_minor bigint DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR length(trim(p_name)) < 1 OR p_opening_balance_minor < 0 OR p_credit_limit_minor < 0 THEN RAISE EXCEPTION 'Invalid wallet'; END IF;
  IF p_wallet_type NOT IN ('cash','bkash','nagad','rocket','bank','savings','debit_card','credit_card','custom') THEN RAISE EXCEPTION 'Invalid wallet type'; END IF;
  INSERT INTO public.wallets (user_id, name, wallet_type, currency, opening_balance_minor, current_balance_minor, credit_limit_minor, notes)
  VALUES (v_user_id, trim(p_name), p_wallet_type, COALESCE(NULLIF(trim(p_currency), ''), 'BDT'), p_opening_balance_minor, p_opening_balance_minor, p_credit_limit_minor, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_wallet(text, text, text, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wallet(text, text, text, bigint, bigint, text) TO authenticated;
