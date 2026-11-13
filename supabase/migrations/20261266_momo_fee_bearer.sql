-- Fee-bearer choice for mobile-money collections (CEO decision
-- 2026-11-12): like the rail's own bearer option, the merchant
-- chooses whether the additional charges are deducted from the
-- BUYER or the SELLER.
--
--   seller (default, today's behaviour): the buyer pays the product
--     amount; the 1% platform charge is collected from the seller's
--     wallet after settlement (migration 20261263).
--   buyer: the buyer is charged the product amount PLUS the 1%
--     service charge on top; the seller receives the full product
--     amount (the wallet is credited with the grossed collection
--     and the 1% charge is auto-collected from it — net exactly
--     the product amount).
--
-- The choice lives on merchant_accounts (one row per merchant) and
-- is read server-side by the shared rail helper on every collection
-- start, so website checkout, payment links, the developer API and
-- plugins all honour the same choice. The rail bearer follows it:
-- buyer -> 'customer', seller -> 'merchant'.
--
-- momo_collections gains base_amount: the product amount the charge
-- is computed on. In seller mode base_amount = amount; in buyer
-- mode amount = base_amount + 1% (the grossed total the buyer is
-- charged) and the charge stays 1% of the base, never of the
-- grossed total. Payment-link totals count the base amount — the
-- product value the seller actually sold.

-- ── Merchant setting ──────────────────────────────────────────────
ALTER TABLE public.merchant_accounts
ADD COLUMN IF NOT EXISTS momo_fee_bearer TEXT NOT NULL DEFAULT 'seller'
  CHECK (momo_fee_bearer IN ('seller', 'buyer'));

-- ── Product (base) amount on the collection ledger ────────────────
ALTER TABLE public.momo_collections
ADD COLUMN IF NOT EXISTS base_amount NUMERIC(14, 2);

UPDATE public.momo_collections
SET base_amount = amount
WHERE base_amount IS NULL;

ALTER TABLE public.momo_collections
ALTER COLUMN base_amount SET NOT NULL;

-- ── Begin: accept the base amount ─────────────────────────────────
-- p_base_amount is the product amount the 1% charge is computed
-- on. NULL means "same as the collection amount" (seller mode and
-- every caller that predates this migration). The shared rail
-- helper passes it; the ledger never trusts a client for it.
CREATE OR REPLACE FUNCTION public.begin_momo_collection(
  p_user_id UUID,
  p_account_id UUID,
  p_reference TEXT,
  p_amount NUMERIC,
  p_operator TEXT,
  p_phone TEXT,
  p_environment TEXT,
  p_source TEXT,
  p_payment_link_id UUID,
  p_idempotency_key TEXT,
  p_base_amount NUMERIC DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, collection_id UUID, transaction_id UUID,
              reference TEXT, collection_status TEXT, wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing public.momo_collections%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_collection_id UUID := gen_random_uuid();
  v_transaction_id UUID := gen_random_uuid();
  v_base_amount NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A merchant is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Amount must be greater than zero with at most two decimal places';
  END IF;
  IF p_base_amount IS NOT NULL AND
     (p_base_amount <= 0 OR round(p_base_amount, 2) <> p_base_amount OR p_base_amount > p_amount) THEN
    RAISE EXCEPTION 'Base amount must be greater than zero, at most two decimal places, and no more than the collection amount';
  END IF;
  v_base_amount := COALESCE(p_base_amount, p_amount);
  IF p_operator NOT IN ('mtn', 'airtel', 'zamtel') THEN
    RAISE EXCEPTION 'operator must be mtn, airtel or zamtel';
  END IF;
  IF p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'environment must be sandbox or production';
  END IF;
  IF p_source NOT IN ('direct', 'payment_link') THEN
    RAISE EXCEPTION 'source must be direct or payment_link';
  END IF;
  IF p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9\-._]{8,64}$' THEN
    RAISE EXCEPTION 'A valid collection reference is required';
  END IF;
  IF p_phone IS NULL OR length(p_phone) < 10 THEN
    RAISE EXCEPTION 'A valid phone number is required';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  -- Serialise concurrent begins carrying the same idempotency key:
  -- the loser re-reads the winner's row instead of aborting on a
  -- unique index after half the work is done.
  PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));

  SELECT c.* INTO v_existing
  FROM public.momo_collections c
  WHERE c.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.amount <> p_amount
       OR v_existing.base_amount <> v_base_amount
       OR v_existing.operator <> p_operator
       OR v_existing.phone <> p_phone THEN
      outcome := 'idempotency_conflict';
    ELSE
      outcome := 'existing';
    END IF;
    collection_id := v_existing.id;
    transaction_id := v_existing.transaction_id;
    reference := v_existing.reference;
    collection_status := v_existing.status;
    SELECT w.balance INTO wallet_balance FROM public.wallets w WHERE w.id = v_existing.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Resolve the merchant's ZMW wallet for the settlement account the
  -- collection belongs to (the link's account, or Main). Fall back to
  -- Main, then create the wallet if the merchant has none yet.
  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.user_id = p_user_id AND w.currency = 'ZMW'
    AND w.account_id IS NOT DISTINCT FROM p_account_id
  ORDER BY w.created_at ASC
  LIMIT 1;

  IF v_wallet.id IS NULL AND p_account_id IS NOT NULL THEN
    SELECT w.* INTO v_wallet
    FROM public.wallets w
    WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL
    ORDER BY w.created_at ASC
    LIMIT 1;
  END IF;

  IF v_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES (p_user_id, 'ZMW', 0, 'active', p_account_id)
    RETURNING * INTO v_wallet;
  END IF;

  INSERT INTO public.transactions (
    uuid_id, user_id, wallet_id, amount, currency, payment_method,
    direction, status, reference, provider, description, metadata
  ) VALUES (
    v_transaction_id, p_user_id, v_wallet.id, p_amount, 'ZMW', 'mobile_money',
    'incoming', 'pending', p_reference, 'mobile_money',
    'Mobile money payment',
    jsonb_build_object(
      'source', p_source,
      'operator', p_operator,
      'payment_link_id', p_payment_link_id,
      'environment', p_environment,
      'base_amount', v_base_amount
    )
  );

  INSERT INTO public.momo_collections (
    id, user_id, wallet_id, transaction_id, reference, idempotency_key,
    amount, base_amount, currency, operator, phone, environment, source, payment_link_id
  ) VALUES (
    v_collection_id, p_user_id, v_wallet.id, v_transaction_id, p_reference,
    p_idempotency_key, p_amount, v_base_amount, 'ZMW', p_operator, p_phone, p_environment,
    p_source, p_payment_link_id
  );

  outcome := 'created';
  collection_id := v_collection_id;
  transaction_id := v_transaction_id;
  reference := p_reference;
  collection_status := 'pending';
  wallet_balance := v_wallet.balance;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC) TO service_role;

-- The 10-argument overload is superseded: CREATE OR REPLACE with
-- a new parameter list leaves the old one standing, and it would
-- fail its own insert (base_amount is NOT NULL) — drop it so only
-- one begin exists. The new signature's DEFAULT NULL keeps
-- not-yet-redeployed callers working until the functions ship.
DROP FUNCTION IF EXISTS public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT);

-- ── Settle: charge 1% of the BASE amount, count the base ──────────
-- The RETURNS TABLE gains base_amount, so the old function must be
-- dropped first (Postgres refuses a return-type change in place).
-- The drop + create run in the migration's single transaction, so
-- no caller ever observes the function missing.
DROP FUNCTION IF EXISTS public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);
-- Everything else is byte-identical to the 20261263 live
-- definition (full credit, terminal guards, amount/currency
-- match, exception-guarded auto-collection, true final balance):
-- only the charge base, the payment-link total, and the returned
-- base_amount change.
CREATE OR REPLACE FUNCTION public.settle_momo_collection(
  p_reference TEXT,
  p_provider_status TEXT,
  p_provider_reference TEXT DEFAULT NULL,
  p_provider_amount NUMERIC DEFAULT NULL,
  p_provider_currency TEXT DEFAULT NULL,
  p_provider_fee NUMERIC DEFAULT NULL,
  p_provider_status_raw TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, collection_status TEXT, transaction_status TEXT,
              wallet_balance NUMERIC, collection_id UUID, transaction_id UUID,
              payment_link_id UUID, merchant_user_id UUID, amount NUMERIC,
              base_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_collection public.momo_collections%ROWTYPE;
  v_wallet_balance NUMERIC;
  v_charge NUMERIC;
BEGIN
  IF p_provider_status NOT IN ('pending', 'successful', 'failed') THEN
    RAISE EXCEPTION 'provider status must be pending, successful or failed';
  END IF;

  SELECT c.* INTO v_collection
  FROM public.momo_collections c
  WHERE c.reference = p_reference
  FOR UPDATE;

  IF v_collection.id IS NULL THEN
    outcome := 'not_found'; collection_status := NULL; transaction_status := NULL;
    wallet_balance := NULL; collection_id := NULL; transaction_id := NULL;
    payment_link_id := NULL; merchant_user_id := NULL; amount := NULL;
    base_amount := NULL;
    RETURN NEXT; RETURN;
  END IF;

  collection_id := v_collection.id;
  transaction_id := v_collection.transaction_id;
  payment_link_id := v_collection.payment_link_id;
  merchant_user_id := v_collection.user_id;
  amount := v_collection.amount;
  base_amount := v_collection.base_amount;

  SELECT w.balance INTO v_wallet_balance FROM public.wallets w WHERE w.id = v_collection.wallet_id;

  -- Terminal rows never move again; a conflicting late status is
  -- reported, never applied.
  IF v_collection.status <> 'pending' THEN
    outcome := CASE WHEN v_collection.status = p_provider_status
      THEN 'already_terminal' ELSE 'terminal_conflict' END;
    collection_status := v_collection.status;
    transaction_status := CASE WHEN v_collection.status = 'successful' THEN 'completed' ELSE 'failed' END;
    wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'pending' THEN
    UPDATE public.momo_collections
    SET provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        provider_fee = COALESCE(p_provider_fee, provider_fee),
        updated_at = now()
    WHERE id = v_collection.id;
    outcome := 'still_pending'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- A terminal settlement must match the ledger exactly. The
  -- provider reports the collection amount it was asked for — the
  -- grossed total in buyer mode, the product amount in seller mode.
  IF p_provider_amount IS NOT NULL AND round(p_provider_amount, 2) <> v_collection.amount THEN
    outcome := 'amount_mismatch'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;
  IF p_provider_currency IS NOT NULL AND upper(p_provider_currency) <> v_collection.currency THEN
    outcome := 'currency_mismatch'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'successful' THEN
    -- Credit the merchant's custodial wallet IN FULL. The platform
    -- charge is a separate ledger entry below — never netted here.
    UPDATE public.wallets
    SET balance = balance + v_collection.amount, updated_at = now()
    WHERE id = v_collection.wallet_id
    RETURNING balance INTO v_wallet_balance;

    UPDATE public.momo_collections
    SET status = 'successful',
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        provider_fee = COALESCE(p_provider_fee, provider_fee),
        settled_at = now(), updated_at = now()
    WHERE id = v_collection.id;

    UPDATE public.transactions
    SET status = 'completed',
        external_reference = COALESCE(p_provider_reference, external_reference),
        description = 'Mobile money payment received',
        updated_at = now()
    WHERE uuid_id = v_collection.transaction_id;

    -- The platform's 1 percent, billed separately to the merchant —
    -- computed on the PRODUCT (base) amount, never on the grossed
    -- total a buyer-bears collection charges on top.
    v_charge := round(v_collection.base_amount * 0.01, 2);
    INSERT INTO public.momo_platform_charges (user_id, collection_id, amount, currency, percent)
    VALUES (v_collection.user_id, v_collection.id, v_charge, v_collection.currency, 1)
    ON CONFLICT (collection_id) DO NOTHING;

    -- Payment-link counters move exactly once, inside the same
    -- transaction as the credit (the terminal guard above is what
    -- makes this once-only). The total counts the product value
    -- the seller actually sold — not the service charge a buyer
    -- paid on top of it.
    IF v_collection.payment_link_id IS NOT NULL THEN
      UPDATE public.payment_links
      SET payment_count = COALESCE(payment_count, 0) + 1,
          total_collected = COALESCE(total_collected, 0) + v_collection.base_amount,
          updated_at = now()
      WHERE id = v_collection.payment_link_id;
    END IF;

    -- Automatic collection (20261263): the charge just recorded —
    -- and any older charges still outstanding on this wallet — is
    -- collected from the wallet the money landed in, as its own
    -- ledger movement. The credit above stays IN FULL; this is a
    -- separate, visible debit. Collection must never fail a
    -- settlement: on any error the charges stay 'recorded' and
    -- the hourly sweep retries them.
    BEGIN
      PERFORM public._momo_collect_wallet_charges(v_collection.user_id, v_collection.wallet_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'momo charge collection failed for user %: %',
        v_collection.user_id, SQLERRM;
    END;

    -- Report the wallet's true final balance (after collection).
    SELECT w.balance INTO v_wallet_balance
    FROM public.wallets w WHERE w.id = v_collection.wallet_id;

    outcome := 'settled'; collection_status := 'successful';
    transaction_status := 'completed'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- FAILED terminal: no credit, no charge — the ledger just closes.
  UPDATE public.momo_collections
  SET status = 'failed',
      provider_reference = COALESCE(p_provider_reference, provider_reference),
      provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
      provider_fee = COALESCE(p_provider_fee, provider_fee),
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      updated_at = now()
  WHERE id = v_collection.id;

  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE uuid_id = v_collection.transaction_id;

  outcome := 'failed_terminal'; collection_status := 'failed';
  transaction_status := 'failed'; wallet_balance := v_wallet_balance;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
