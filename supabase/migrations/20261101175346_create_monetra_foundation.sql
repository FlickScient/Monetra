/*
# Create MoneTra foundation and accounting engine

1. New tables
- `profiles`: one private profile for each authenticated user.
- `wallets`: user-owned cash and liability accounts, with integer minor-unit balances.
- `categories`: user-owned income and expense categories with optional subcategories.
- `transactions`: user-facing financial events, including wallet transfers.
- `ledger_accounts`: double-entry accounts attached to a wallet or system purpose.
- `ledger_entries`: balanced debit and credit lines for every posted transaction.

2. Accounting rules
- All monetary values are BIGINT minor units; no floating point amounts are stored.
- Credit cards are liability wallets and are excluded from positive available balance.
- Transfers post between wallet ledger accounts and do not count as income or expense.
- The `post_finance_transaction` function updates wallets and ledger lines atomically.

3. Security
- RLS is enabled on every table.
- All tables are restricted to the authenticated owner through `auth.uid()`.
- Only the authenticated role receives Data API privileges.
- The posting function is callable only by authenticated users.

4. Important notes
- The app uses Supabase Auth as the available managed authentication service.
- Existing records are not modified or deleted by this migration.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  currency text NOT NULL DEFAULT 'BDT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  wallet_type text NOT NULL CHECK (wallet_type IN ('cash','bkash','nagad','rocket','bank','savings','debit_card','credit_card','custom')),
  currency text NOT NULL DEFAULT 'BDT',
  opening_balance_minor bigint NOT NULL DEFAULT 0,
  current_balance_minor bigint NOT NULL DEFAULT 0,
  credit_limit_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_type text NOT NULL CHECK (category_type IN ('income','expense')),
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  color text NOT NULL DEFAULT '#0f766e',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense','transfer','refund','adjustment')),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  destination_wallet_id uuid REFERENCES public.wallets(id),
  category_id uuid REFERENCES public.categories(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  description text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE CASCADE,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','income','expense','equity')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  ledger_account_id uuid NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE CASCADE,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entry_one_side CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);

CREATE INDEX IF NOT EXISTS wallets_user_id_idx ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS categories_user_id_idx ON public.categories(user_id);
CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON public.transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx ON public.ledger_entries(transaction_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT ON public.transactions TO authenticated;
GRANT SELECT ON public.ledger_accounts TO authenticated;
GRANT SELECT ON public.ledger_entries TO authenticated;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "wallets_select_own" ON public.wallets;
CREATE POLICY "wallets_select_own" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "wallets_insert_own" ON public.wallets;
CREATE POLICY "wallets_insert_own" ON public.wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "wallets_update_own" ON public.wallets;
CREATE POLICY "wallets_update_own" ON public.wallets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "wallets_delete_own" ON public.wallets;
CREATE POLICY "wallets_delete_own" ON public.wallets FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "categories_select_own" ON public.categories;
CREATE POLICY "categories_select_own" ON public.categories FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "categories_insert_own" ON public.categories;
CREATE POLICY "categories_insert_own" ON public.categories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "categories_update_own" ON public.categories;
CREATE POLICY "categories_update_own" ON public.categories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "categories_delete_own" ON public.categories;
CREATE POLICY "categories_delete_own" ON public.categories FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "transactions_select_own" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "ledger_accounts_select_own" ON public.ledger_accounts;
CREATE POLICY "ledger_accounts_select_own" ON public.ledger_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "ledger_entries_select_own" ON public.ledger_entries;
CREATE POLICY "ledger_entries_select_own" ON public.ledger_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'MoneTra user'), '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_monetra ON auth.users;
CREATE TRIGGER on_auth_user_created_monetra AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

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
BEGIN
  IF v_user_id IS NULL OR p_amount_minor <= 0 THEN RAISE EXCEPTION 'Invalid transaction'; END IF;
  SELECT wallet_type INTO v_wallet_type FROM public.wallets WHERE id = p_wallet_id AND user_id = v_user_id AND status = 'active';
  IF v_wallet_type IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF p_transaction_type = 'transfer' AND (p_destination_wallet_id IS NULL OR p_destination_wallet_id = p_wallet_id) THEN RAISE EXCEPTION 'Transfer destination required'; END IF;
  IF p_transaction_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_destination_wallet_id AND user_id = v_user_id AND status = 'active') THEN RAISE EXCEPTION 'Destination wallet not found'; END IF;

  INSERT INTO public.transactions (user_id, transaction_type, wallet_id, destination_wallet_id, category_id, amount_minor, description, occurred_at)
  VALUES (v_user_id, p_transaction_type, p_wallet_id, p_destination_wallet_id, p_category_id, p_amount_minor, p_description, p_occurred_at)
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.ledger_accounts (user_id, wallet_id, account_type, name)
  VALUES (v_user_id, p_wallet_id, CASE WHEN v_wallet_type = 'credit_card' THEN 'liability' ELSE 'asset' END, 'Wallet: ' || p_wallet_id::text)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_source_account FROM public.ledger_accounts WHERE wallet_id = p_wallet_id AND user_id = v_user_id;

  IF p_transaction_type = 'transfer' THEN
    INSERT INTO public.ledger_accounts (user_id, wallet_id, account_type, name)
    SELECT v_user_id, id, CASE WHEN wallet_type = 'credit_card' THEN 'liability' ELSE 'asset' END, 'Wallet: ' || id::text FROM public.wallets WHERE id = p_destination_wallet_id
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_destination_account FROM public.ledger_accounts WHERE wallet_id = p_destination_wallet_id AND user_id = v_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_destination_account, p_amount_minor);
    INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
    UPDATE public.wallets SET current_balance_minor = current_balance_minor - p_amount_minor, updated_at = now() WHERE id = p_wallet_id;
    UPDATE public.wallets SET current_balance_minor = current_balance_minor + p_amount_minor, updated_at = now() WHERE id = p_destination_wallet_id;
  ELSE
    INSERT INTO public.ledger_accounts (user_id, account_type, name) VALUES (v_user_id, CASE WHEN p_transaction_type IN ('income','refund') THEN 'income' ELSE 'expense' END, initcap(p_transaction_type)) RETURNING id INTO v_category_account;
    IF p_transaction_type IN ('income','refund') THEN
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, debit_minor) VALUES (v_user_id, v_transaction_id, v_source_account, p_amount_minor);
      INSERT INTO public.ledger_entries (user_id, transaction_id, ledger_account_id, credit_minor) VALUES (v_user_id, v_transaction_id, v_category_account, p_amount_minor);
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
