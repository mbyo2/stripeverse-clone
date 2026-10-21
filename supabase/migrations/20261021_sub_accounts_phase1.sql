-- Sub-accounts Phase 1 (Binance-style): accounts grouping over wallets.
--
-- Design: files/bmaglasspay/sub-accounts-design.md (goal workspace).
-- Model: sub-accounts live inside the one user. A new `accounts` table
-- groups wallets; `wallets.account_id` NULL == the Main account (no
-- backfill, existing rows untouched). Wallet ownership stays `user_id`,
-- so all existing wallet RLS keeps working unchanged.
--
-- Apply order matters: this file is applied to paymentgetway FIRST,
-- verified with rolled-back probes, and only then is the frontend branch
-- (feature/sub-accounts) merged.

-- ── 1. accounts table ────────────────────────────────────────────────────
CREATE TABLE public.accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'custom'
             CHECK (kind IN ('business','savings','trading','personal','custom')),
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','frozen','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ,
  metadata   JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_accounts_user ON public.accounts (user_id);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own accounts"
  ON public.accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 2. wallets.account_id + per-account uniqueness ───────────────────────
ALTER TABLE public.wallets
  ADD COLUMN account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT;

CREATE INDEX idx_wallets_account ON public.wallets (account_id);

-- Replace UNIQUE(user_id, currency) with per-account partial uniques
-- (a plain UNIQUE(user_id, account_id, currency) would treat NULL
-- account_id rows as distinct and allow duplicate Main wallets).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.wallets'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE 'UNIQUE (user_id, currency)';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.wallets DROP CONSTRAINT %I', c);
  END IF;
END $$;

CREATE UNIQUE INDEX wallets_main_currency_uq
  ON public.wallets (user_id, currency) WHERE account_id IS NULL;
CREATE UNIQUE INDEX wallets_sub_currency_uq
  ON public.wallets (account_id, currency) WHERE account_id IS NOT NULL;

-- ── 3. Sub-account cap ───────────────────────────────────────────────────
-- CEO direction 2026-10-21: ship simple, restore the fancy wiring later.
-- Free tier = 3 non-closed sub-accounts. Paid tiers are uncapped for now;
-- the follow-up (when wanted) reads the limit from pricing tier data.
CREATE OR REPLACE FUNCTION public.sub_account_cap(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tier text;
BEGIN
  SELECT subscription_tier INTO v_tier
  FROM public.subscribers
  WHERE user_id = p_user_id;
  IF v_tier IS NULL OR lower(v_tier) = 'free' THEN
    RETURN 3;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sub_account_cap(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sub_account_cap(uuid) TO authenticated;

-- ── 4. Lifecycle RPCs (authenticated; ownership enforced inside) ────────
CREATE OR REPLACE FUNCTION public.create_sub_account(p_name text, p_kind text DEFAULT 'custom')
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_cap integer;
  v_count integer;
  v_account public.accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF length(v_name) < 1 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Sub-account name must be 1-60 characters';
  END IF;
  IF p_kind NOT IN ('business','savings','trading','personal','custom') THEN
    RAISE EXCEPTION 'Invalid sub-account kind: %', p_kind;
  END IF;

  v_cap := public.sub_account_cap(v_uid);
  IF v_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.accounts
    WHERE user_id = v_uid AND status <> 'closed';
    IF v_count >= v_cap THEN
      RAISE EXCEPTION 'Sub-account limit reached for your plan (%)', v_cap;
    END IF;
  END IF;

  INSERT INTO public.accounts (user_id, name, kind)
  VALUES (v_uid, v_name, p_kind)
  RETURNING * INTO v_account;

  INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
  VALUES (v_uid, v_account.id, 'ZMW', 0, 'active');

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_sub_account(p_account_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(v_name) < 1 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Sub-account name must be 1-60 characters';
  END IF;
  UPDATE public.accounts SET name = v_name
  WHERE id = p_account_id AND user_id = v_uid AND status <> 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-account not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sub_account_status(p_account_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_status NOT IN ('active','frozen') THEN
    RAISE EXCEPTION 'Status must be active or frozen (use close_sub_account to close)';
  END IF;
  UPDATE public.accounts SET status = p_status
  WHERE id = p_account_id AND user_id = v_uid AND status <> 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-account not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_sub_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.wallets
    WHERE account_id = p_account_id AND user_id = v_uid AND balance <> 0
  ) THEN
    RAISE EXCEPTION 'Sub-account can only be closed when all its wallets are at zero balance';
  END IF;
  UPDATE public.accounts
  SET status = 'closed', closed_at = now()
  WHERE id = p_account_id AND user_id = v_uid AND status <> 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-account not found'; END IF;
  UPDATE public.wallets SET status = 'closed'
  WHERE account_id = p_account_id AND user_id = v_uid;
END;
$$;

-- ── 5. Internal transfer (same user, same currency) ──────────────────────
-- Modelled on execute_atomic_transfer: row locks in id order, idempotent
-- via transactions.idempotency_key (outgoing = key, incoming = key||':in').
CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_description text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid, new_sender_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from public.wallets;
  v_to public.wallets;
  v_from_account_status text;
  v_to_account_status text;
  v_existing_id uuid;
  v_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'Source and destination wallets must differ';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: replay returns the original result.
  SELECT t.id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT t.id, w.balance INTO v_tx_id, new_sender_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.id = v_existing_id;
    transaction_id := v_tx_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock both wallet rows in id order (deadlock-safe).
  PERFORM 1 FROM public.wallets
  WHERE id IN (p_from_wallet_id, p_to_wallet_id)
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_from FROM public.wallets WHERE id = p_from_wallet_id;
  SELECT * INTO v_to FROM public.wallets WHERE id = p_to_wallet_id;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF v_from.user_id <> v_uid OR v_to.user_id <> v_uid THEN
    RAISE EXCEPTION 'Both wallets must belong to you';
  END IF;
  IF v_from.currency <> v_to.currency THEN
    RAISE EXCEPTION 'Internal transfers require the same currency on both wallets';
  END IF;
  IF v_from.status <> 'active' OR v_to.status <> 'active' THEN
    RAISE EXCEPTION 'Both wallets must be active';
  END IF;

  SELECT status INTO v_from_account_status FROM public.accounts WHERE id = v_from.account_id;
  SELECT status INTO v_to_account_status FROM public.accounts WHERE id = v_to.account_id;
  IF v_from.account_id IS NOT NULL AND v_from_account_status <> 'active' THEN
    RAISE EXCEPTION 'Source account is % and cannot send', v_from_account_status;
  END IF;
  IF v_to.account_id IS NOT NULL AND v_to_account_status = 'closed' THEN
    RAISE EXCEPTION 'Destination account is closed';
  END IF;

  IF v_from.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_from.balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_from.id;
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_to.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_uid, v_to.id, p_amount, v_from.currency, 'incoming', 'wallet',
     'completed', p_description, 'internal:' || p_to_wallet_id::text,
     'internal_transfer', p_idempotency_key || ':in');

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_uid, v_from.id, p_amount, v_from.currency, 'outgoing', 'wallet',
     'completed', p_description, 'internal:' || p_from_wallet_id::text,
     'internal_transfer', p_idempotency_key)
  RETURNING id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_from.balance - p_amount;
  RETURN NEXT;
END;
$$;

-- ── 6. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_sub_account(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_sub_account(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_sub_account_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_sub_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sub_account(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_sub_account(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sub_account_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_sub_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(uuid, uuid, numeric, text, text) TO authenticated;
