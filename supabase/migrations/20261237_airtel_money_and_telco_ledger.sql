-- ============================================================================
-- Direct telco rails: Airtel kill switch + shared mobile-money ledger.
--
-- MTN MoMo already has its kill switch (20261236). This migration adds
-- the matching Airtel switch and the provider-neutral ledger the
-- mobile-money edge function uses for BOTH direct telco rails:
--
--   platform_settings.airtel_money_enabled — default FALSE.
--     Only literal true is ON. Secrets absent -> not_configured;
--     secrets present + flag OFF -> disabled; secrets present + flag
--     ON -> the provider client may run. The flag alone never moves
--     money.
--
--   public.mobile_money_payments — one row per provider payment.
--     The row is created BEFORE any provider network call by
--     begin_mobile_money_payment, together with its transactions row.
--     provider_reference is OUR UUID: MTN sends it as X-Reference-Id;
--     Airtel sends it as the transaction reference/id through the
--     adapter point in _shared/airtel-money.ts. A provider duplicate
--     therefore always resolves to this one row, never a second debit
--     or credit.
--
-- Money doctrine (same as PayPal / Lightning):
--   * Ledger first, provider call second.
--   * A collection credits ONLY from settle_mobile_money_payment,
--     called with a status obtained by RE-QUERYING the provider.
--     Callbacks are hints: record_mobile_money_callback_hint changes
--     no payment status and moves no balance.
--   * A disbursement debits the wallet inside begin (the hold IS the
--     debit — there is no separate hold balance), and exactly one of
--     three terminal paths can follow: provider SUCCESSFUL leaves the
--     debit in place, provider FAILED refunds it once, and a definite
--     provider rejection before acceptance refunds it once through
--     update_mobile_money_submission. The wallet_effect column is the
--     guard: a refund is possible only from wallet_effect='debited'.
--   * Settlement verifies provider amount + currency against the
--     ledger row before moving anything; a mismatch changes nothing.
--   * All functions are SECURITY DEFINER, service_role only. The
--     edge function calls them through a service-role client that
--     does not forward the caller's JWT, so protect_wallet_balance
--     does not neutralise the balance updates.
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS airtel_money_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.mobile_money_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(uuid_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('mtn', 'airtel')),
  product TEXT NOT NULL CHECK (product IN ('collection', 'disbursement')),
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  provider_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  phone_msisdn TEXT NOT NULL,
  amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'successful', 'failed')),
  submission_state TEXT NOT NULL DEFAULT 'created'
    CHECK (submission_state IN ('created', 'accepted', 'unknown', 'rejected')),
  submission_error_kind TEXT,
  submitted_at TIMESTAMPTZ,
  wallet_effect TEXT NOT NULL DEFAULT 'none'
    CHECK (wallet_effect IN ('none', 'credited', 'debited', 'debit_finalized', 'refunded')),
  provider_transaction_id TEXT,
  provider_status_raw TEXT,
  provider_reason_code TEXT,
  provider_reason_message TEXT,
  callback_count INTEGER NOT NULL DEFAULT 0,
  last_callback_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_user_created
  ON public.mobile_money_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_provider_status
  ON public.mobile_money_payments(provider, status, created_at);
CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_provider_txn
  ON public.mobile_money_payments(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

ALTER TABLE public.mobile_money_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own mobile money payments" ON public.mobile_money_payments;
CREATE POLICY "Users view own mobile money payments"
ON public.mobile_money_payments FOR SELECT TO authenticated
USING (auth.uid() = user_id);
-- No client write policies: rows are created and settled only by the
-- service-role RPCs below.

-- ── Begin: ledger row + transactions row (+ disbursement debit) ─────
CREATE OR REPLACE FUNCTION public.begin_mobile_money_payment(
  p_user_id UUID,
  p_wallet_id UUID,
  p_provider TEXT,
  p_product TEXT,
  p_phone_msisdn TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_idempotency_key TEXT,
  p_provider_reference TEXT
)
RETURNS TABLE(outcome TEXT, payment_id UUID, transaction_id UUID,
              provider_reference TEXT, payment_status TEXT,
              wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.mobile_money_payments%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_direction TEXT;
  v_payment_id UUID := gen_random_uuid();
  v_transaction_id UUID := gen_random_uuid();
  v_provider_label TEXT;
BEGIN
  IF p_user_id IS NULL OR p_wallet_id IS NULL THEN
    RAISE EXCEPTION 'A user and wallet are required';
  END IF;
  IF p_provider NOT IN ('mtn', 'airtel') THEN
    RAISE EXCEPTION 'provider must be mtn or airtel';
  END IF;
  IF p_product NOT IN ('collection', 'disbursement') THEN
    RAISE EXCEPTION 'product must be collection or disbursement';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Amount must be greater than zero with at most two decimal places';
  END IF;
  IF p_currency IS NULL OR upper(p_currency) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'A valid currency is required';
  END IF;
  IF p_phone_msisdn IS NULL OR length(p_phone_msisdn) < 10 THEN
    RAISE EXCEPTION 'A valid phone number is required';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;
  IF p_provider_reference IS NULL OR length(p_provider_reference) < 8 THEN
    RAISE EXCEPTION 'A provider reference is required';
  END IF;

  -- Serialise concurrent begins carrying the same idempotency key:
  -- the loser re-reads the winner's row below instead of aborting on
  -- a unique index after half the work is done.
  PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));

  SELECT mp.* INTO v_existing
  FROM public.mobile_money_payments mp
  WHERE mp.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.wallet_id <> p_wallet_id
       OR v_existing.provider <> p_provider
       OR v_existing.product <> p_product
       OR v_existing.phone_msisdn <> p_phone_msisdn
       OR v_existing.amount <> p_amount
       OR v_existing.currency <> upper(p_currency) THEN
      outcome := 'idempotency_conflict';
    ELSE
      outcome := 'existing';
    END IF;
    payment_id := v_existing.id;
    transaction_id := v_existing.transaction_id;
    provider_reference := v_existing.provider_reference;
    payment_status := v_existing.status;
    SELECT w.balance INTO wallet_balance FROM public.wallets w WHERE w.id = v_existing.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_direction := CASE WHEN p_product = 'collection' THEN 'incoming' ELSE 'outgoing' END;
  v_provider_label := CASE WHEN p_provider = 'mtn' THEN 'MTN MoMo' ELSE 'Airtel Money' END;

  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = p_wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    outcome := 'wallet_not_found'; payment_id := NULL; transaction_id := NULL;
    provider_reference := NULL; payment_status := NULL; wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF v_wallet.user_id <> p_user_id THEN
    outcome := 'wallet_not_owned'; payment_id := NULL; transaction_id := NULL;
    provider_reference := NULL; payment_status := NULL; wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF upper(v_wallet.currency) <> upper(p_currency) THEN
    outcome := 'currency_mismatch'; payment_id := NULL; transaction_id := NULL;
    provider_reference := NULL; payment_status := NULL; wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF v_wallet.status = 'closed'
     OR (p_product = 'disbursement' AND v_wallet.status <> 'active') THEN
    outcome := 'wallet_not_active'; payment_id := NULL; transaction_id := NULL;
    provider_reference := NULL; payment_status := NULL; wallet_balance := v_wallet.balance;
    RETURN NEXT; RETURN;
  END IF;
  IF p_product = 'disbursement' AND v_wallet.balance < p_amount THEN
    outcome := 'insufficient_funds'; payment_id := NULL; transaction_id := NULL;
    provider_reference := NULL; payment_status := NULL; wallet_balance := v_wallet.balance;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.transactions (
    uuid_id, user_id, wallet_id, amount, currency, direction, status,
    payment_method, provider, reference, transaction_id,
    recipient_name, recipient_account, description, category,
    metadata, idempotency_key
  ) VALUES (
    v_transaction_id, p_user_id, p_wallet_id, p_amount, upper(p_currency),
    v_direction, 'pending', 'mobile_money', p_provider, p_provider_reference,
    concat(p_provider, ':', p_provider_reference),
    v_provider_label, p_phone_msisdn,
    CASE WHEN p_product = 'collection'
      THEN concat(v_provider_label, ' deposit (awaiting confirmation)')
      ELSE concat(v_provider_label, ' withdrawal (awaiting confirmation)') END,
    CASE WHEN p_product = 'collection' THEN 'deposit' ELSE 'withdrawal' END,
    jsonb_build_object(
      'kind', 'mobile_money_payment',
      'provider', p_provider,
      'product', p_product,
      'payment_id', v_payment_id,
      'phone_msisdn', p_phone_msisdn
    ),
    concat('mobile-money:', p_provider, ':', p_idempotency_key)
  );

  INSERT INTO public.mobile_money_payments (
    id, transaction_id, user_id, wallet_id, provider, product, direction,
    provider_reference, idempotency_key, phone_msisdn, amount, currency,
    wallet_effect
  ) VALUES (
    v_payment_id, v_transaction_id, p_user_id, p_wallet_id, p_provider,
    p_product, v_direction, p_provider_reference, p_idempotency_key,
    p_phone_msisdn, p_amount, upper(p_currency),
    CASE WHEN p_product = 'disbursement' THEN 'debited' ELSE 'none' END
  );

  IF p_product = 'disbursement' THEN
    UPDATE public.wallets
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_wallet.id
    RETURNING balance INTO wallet_balance;
  ELSE
    wallet_balance := v_wallet.balance;
  END IF;

  outcome := 'created';
  payment_id := v_payment_id;
  transaction_id := v_transaction_id;
  provider_reference := p_provider_reference;
  payment_status := 'pending';
  RETURN NEXT;
END;
$$;

-- ── Submission outcome: accepted / unknown / definitely rejected ────
CREATE OR REPLACE FUNCTION public.update_mobile_money_submission(
  p_provider_reference TEXT,
  p_state TEXT,
  p_error_kind TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, payment_status TEXT, wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
BEGIN
  IF p_state NOT IN ('accepted', 'unknown', 'rejected') THEN
    RAISE EXCEPTION 'state must be accepted, unknown or rejected';
  END IF;

  SELECT mp.* INTO v_payment
  FROM public.mobile_money_payments mp
  WHERE mp.provider_reference = p_provider_reference
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    outcome := 'not_found'; payment_status := NULL; wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT w.balance INTO wallet_balance FROM public.wallets w WHERE w.id = v_payment.wallet_id;

  IF v_payment.status <> 'pending' THEN
    outcome := 'already_terminal';
    payment_status := v_payment.status;
    RETURN NEXT; RETURN;
  END IF;

  IF p_state = 'accepted' THEN
    UPDATE public.mobile_money_payments
    SET submission_state = 'accepted', submitted_at = now(), updated_at = now()
    WHERE id = v_payment.id;
    outcome := 'accepted'; payment_status := 'pending';
    RETURN NEXT; RETURN;
  END IF;

  IF p_state = 'unknown' THEN
    UPDATE public.mobile_money_payments
    SET submission_state = 'unknown', submission_error_kind = p_error_kind,
        updated_at = now()
    WHERE id = v_payment.id;
    outcome := 'marked_unknown'; payment_status := 'pending';
    RETURN NEXT; RETURN;
  END IF;

  -- Rejected BEFORE acceptance: the provider answered with a
  -- definitive refusal, so no provider transaction exists. Fail the
  -- row and refund a disbursement debit exactly once.
  IF v_payment.product = 'disbursement' AND v_payment.wallet_effect = 'debited' THEN
    UPDATE public.wallets
    SET balance = balance + v_payment.amount, updated_at = now()
    WHERE id = v_payment.wallet_id
    RETURNING balance INTO wallet_balance;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'failed',
      submission_state = 'rejected',
      submission_error_kind = p_error_kind,
      wallet_effect = CASE
        WHEN product = 'disbursement' AND wallet_effect = 'debited' THEN 'refunded'
        ELSE wallet_effect END,
      settled_at = now(),
      updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.transactions
  SET status = 'failed',
      description = CASE WHEN v_payment.product = 'collection'
        THEN 'Mobile money deposit was not accepted by the provider'
        ELSE 'Mobile money withdrawal was not accepted by the provider — amount returned' END,
      updated_at = now()
  WHERE uuid_id = v_payment.transaction_id;

  outcome := 'rejected';
  payment_status := 'failed';
  RETURN NEXT;
END;
$$;

-- ── Callback hint: identify only, never settle ──────────────────────
CREATE OR REPLACE FUNCTION public.record_mobile_money_callback_hint(
  p_provider TEXT,
  p_transaction_id UUID DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL,
  p_provider_transaction_id TEXT DEFAULT NULL
)
RETURNS TABLE(payment_id UUID, transaction_id UUID, provider_reference TEXT,
              product TEXT, payment_status TEXT, user_id UUID, wallet_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
BEGIN
  SELECT mp.* INTO v_payment
  FROM public.mobile_money_payments mp
  WHERE mp.provider = p_provider
    AND (
      (p_transaction_id IS NOT NULL AND mp.transaction_id = p_transaction_id)
      OR (p_provider_reference IS NOT NULL AND mp.provider_reference = p_provider_reference)
      OR (p_provider_transaction_id IS NOT NULL
          AND mp.provider_transaction_id = p_provider_transaction_id)
    )
  ORDER BY mp.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    payment_id := NULL; transaction_id := NULL; provider_reference := NULL;
    product := NULL; payment_status := NULL; user_id := NULL; wallet_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.mobile_money_payments
  SET callback_count = callback_count + 1, last_callback_at = now(), updated_at = now()
  WHERE id = v_payment.id;

  payment_id := v_payment.id;
  transaction_id := v_payment.transaction_id;
  provider_reference := v_payment.provider_reference;
  product := v_payment.product;
  payment_status := v_payment.status;
  user_id := v_payment.user_id;
  wallet_id := v_payment.wallet_id;
  RETURN NEXT;
END;
$$;

-- ── Settlement: only from a re-queried provider status ──────────────
CREATE OR REPLACE FUNCTION public.settle_mobile_money_payment(
  p_provider TEXT,
  p_provider_reference TEXT,
  p_provider_status TEXT,
  p_provider_transaction_id TEXT DEFAULT NULL,
  p_provider_amount NUMERIC DEFAULT NULL,
  p_provider_currency TEXT DEFAULT NULL,
  p_provider_status_raw TEXT DEFAULT NULL,
  p_reason_code TEXT DEFAULT NULL,
  p_reason_message TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, payment_status TEXT, transaction_status TEXT,
              wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_wallet_balance NUMERIC;
BEGIN
  IF p_provider_status NOT IN ('pending', 'successful', 'failed') THEN
    RAISE EXCEPTION 'provider status must be pending, successful or failed';
  END IF;

  SELECT mp.* INTO v_payment
  FROM public.mobile_money_payments mp
  WHERE mp.provider = p_provider AND mp.provider_reference = p_provider_reference
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    outcome := 'not_found'; payment_status := NULL; transaction_status := NULL;
    wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT w.balance INTO v_wallet_balance FROM public.wallets w WHERE w.id = v_payment.wallet_id;

  -- Terminal rows never move again; a conflicting late status is
  -- reported, never applied.
  IF v_payment.status <> 'pending' THEN
    outcome := CASE WHEN v_payment.status = p_provider_status
      THEN 'already_terminal' ELSE 'terminal_conflict' END;
    payment_status := v_payment.status;
    transaction_status := CASE WHEN v_payment.status = 'successful' THEN 'completed' ELSE 'failed' END;
    wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'pending' THEN
    UPDATE public.mobile_money_payments
    SET provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        provider_transaction_id = COALESCE(p_provider_transaction_id, provider_transaction_id),
        updated_at = now()
    WHERE id = v_payment.id;
    outcome := 'still_pending'; payment_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- A terminal settlement must match the ledger exactly.
  IF p_provider_amount IS NOT NULL AND round(p_provider_amount, 2) <> v_payment.amount THEN
    outcome := 'amount_mismatch'; payment_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;
  IF p_provider_currency IS NOT NULL AND upper(p_provider_currency) <> v_payment.currency THEN
    outcome := 'currency_mismatch'; payment_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'successful' THEN
    IF v_payment.product = 'collection' THEN
      UPDATE public.wallets
      SET balance = balance + v_payment.amount, updated_at = now()
      WHERE id = v_payment.wallet_id
      RETURNING balance INTO v_wallet_balance;
    END IF;

    UPDATE public.mobile_money_payments
    SET status = 'successful',
        wallet_effect = CASE
          WHEN product = 'collection' THEN 'credited'
          WHEN wallet_effect = 'debited' THEN 'debit_finalized'
          ELSE wallet_effect END,
        provider_transaction_id = COALESCE(p_provider_transaction_id, provider_transaction_id),
        provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        settled_at = now(), updated_at = now()
    WHERE id = v_payment.id;

    UPDATE public.transactions
    SET status = 'completed',
        external_reference = COALESCE(p_provider_transaction_id, external_reference),
        description = CASE WHEN v_payment.product = 'collection'
          THEN 'Mobile money deposit confirmed'
          ELSE 'Mobile money withdrawal confirmed' END,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'provider_transaction_id', p_provider_transaction_id,
          'settled_at', now()
        ),
        updated_at = now()
    WHERE uuid_id = v_payment.transaction_id;

    outcome := 'settled'; payment_status := 'successful';
    transaction_status := 'completed'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- FAILED terminal: refund a disbursement debit exactly once.
  IF v_payment.product = 'disbursement' AND v_payment.wallet_effect = 'debited' THEN
    UPDATE public.wallets
    SET balance = balance + v_payment.amount, updated_at = now()
    WHERE id = v_payment.wallet_id
    RETURNING balance INTO v_wallet_balance;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'failed',
      wallet_effect = CASE
        WHEN product = 'disbursement' AND wallet_effect = 'debited' THEN 'refunded'
        ELSE wallet_effect END,
      provider_transaction_id = COALESCE(p_provider_transaction_id, provider_transaction_id),
      provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
      provider_reason_code = p_reason_code,
      provider_reason_message = p_reason_message,
      settled_at = now(), updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.transactions
  SET status = 'failed',
      external_reference = COALESCE(p_provider_transaction_id, external_reference),
      description = CASE WHEN v_payment.product = 'collection'
        THEN 'Mobile money deposit did not complete'
        ELSE 'Mobile money withdrawal did not complete — amount returned' END,
      updated_at = now()
  WHERE uuid_id = v_payment.transaction_id;

  outcome := 'settled_failed'; payment_status := 'failed';
  transaction_status := 'failed'; wallet_balance := v_wallet_balance;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_mobile_money_payment(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.update_mobile_money_submission(TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.record_mobile_money_callback_hint(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.settle_mobile_money_payment(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.begin_mobile_money_payment(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_mobile_money_submission(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mobile_money_callback_hint(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_mobile_money_payment(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;
