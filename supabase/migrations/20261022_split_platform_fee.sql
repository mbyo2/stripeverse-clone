-- Split Payments: the platform takes its cut of every payment-link
-- settlement, first — before the owner's split rules run.
--
-- CEO directive (2026-10-22): "On the split remember that part of it
-- is for the platform just like on PayPal or Stripe. Except for Bitcoin
-- wallet and transfer which doesn't have the split for the platform."
-- So this fee exists ONLY inside execute_payment_link_settlement — the
-- split-payments choke point. User-to-user transfers, Send Money,
-- deposits, internal transfers, currency conversion and every Bitcoin
-- path are untouched and carry no platform split.
--
-- SETTINGS STORE: public.platform_settings is a singleton table (one
-- row, id = true) holding split_platform_fee_percent, seeded at 2.5.
-- Authenticated users may READ it (the Split Payments page displays
-- the rate); only service_role can change it — there are deliberately
-- no authenticated write policies. The settlement function reads the
-- rate defensively: if the row were ever missing it falls back to 2.5
-- rather than failing a settlement.
--
-- PLATFORM LEG (runs first, before merchant split rules):
--   - fee = round(p_amount * rate / 100, 2), capped at p_amount —
--     a share of the ORIGINAL payment amount, like the percentage
--     split legs below.
--   - The fee is debited from the owner's settlement wallet and
--     credited to the PLATFORM wallet: the platform operator is the
--     earliest-created user holding role 'admin' in public.user_roles
--     (ORDER BY created_at, then user_id). Their MAIN wallet
--     (account_id NULL) in the settlement currency receives it,
--     created on demand — the same pattern the split block uses for
--     recipients. A frozen platform wallet may receive; a closed one
--     skips the leg.
--   - The leg is skipped entirely (the share stays with the owner)
--     when: the rate is <= 0 (or the fee rounds to 0), no admin user
--     exists, the platform wallet is closed, or the link owner IS
--     the platform recipient (the platform does not fee itself).
--   - Merchant split rules then run exactly as before, except
--     v_remaining starts at p_amount - fee: merchant legs are still
--     shares of the ORIGINAL payment amount, capped at what remains
--     after the fee, so platform fee + merchant legs + owner residual
--     = the payment exactly. Rounding never creates or destroys money.
--   - owner_new_balance truthfully reports the owner's post-fee,
--     post-split balance.
--
-- IDEMPOTENCY: the settlement replay early-return is unchanged, and
-- the fee leg writes its own rows under the settlement key
-- (<key>:platform_fee:out / <key>:platform_fee:in) on the
-- transactions.idempotency_key unique index — a settlement can never
-- take the fee twice.
--
-- LEDGER: an owner OUTGOING row (category 'platform_fee',
-- recipient_name 'BMaGlass Pay', description 'Platform fee — payment
-- link: <link title>') and a platform INCOMING row (category
-- 'platform_fee', recipient_name = the link owner's profile name,
-- same description) — both sides see the fee in their history.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true,
  split_platform_fee_percent numeric NOT NULL DEFAULT 2.5,
  CONSTRAINT platform_settings_singleton CHECK (id)
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in user (the Split Payments page shows the
-- rate). No INSERT/UPDATE/DELETE policies for authenticated: writes
-- are service_role only.
CREATE POLICY "Authenticated users can read platform settings"
  ON public.platform_settings FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.platform_settings (id, split_platform_fee_percent)
VALUES (true, 2.5)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.execute_payment_link_settlement(
  p_link_id uuid,
  p_payer_user_id uuid,           -- NULL = external (gateway) payment
  p_amount numeric,
  p_idempotency_key text,
  p_payment_method text DEFAULT 'wallet',
  p_description text DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  owner_transaction_id uuid,
  owner_new_balance numeric,
  payer_new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.payment_links;
  v_account public.accounts;
  v_owner_wallet public.wallets;
  v_payer_wallet public.wallets;
  v_existing_in uuid;
  v_existing_out uuid;
  v_owner_tx uuid;
  v_payer_tx uuid;
  -- Platform fee state.
  v_fee_rate numeric;             -- platform_settings.split_platform_fee_percent
  v_platform_fee numeric := 0;    -- fee actually taken (0 when the leg is skipped)
  v_platform_user uuid;           -- platform operator (earliest-created admin)
  v_platform_wallet public.wallets;
  -- Split execution state.
  v_owner_balance numeric;        -- owner's balance after the gross credit
  v_remaining numeric;            -- undiverted remainder of the payment
  v_rule record;
  v_recipient_user uuid;
  v_recipient_wallet public.wallets;
  v_leg numeric;
  v_owner_name text;
BEGIN
  -- A live user session may only ever act as itself (defence in depth;
  -- the normal path is a service_role call with no session at all).
  IF auth.uid() IS NOT NULL AND p_payer_user_id IS NOT NULL
     AND auth.uid() <> p_payer_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a settled link payment always leaves exactly one owner
  -- incoming row keyed <key>:in. A replay returns the original result.
  SELECT t.uuid_id INTO v_existing_in
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key || ':in'
    AND t.direction = 'incoming'
  LIMIT 1;
  IF v_existing_in IS NOT NULL THEN
    SELECT t.uuid_id INTO v_existing_out
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    SELECT t.uuid_id, w.balance INTO v_owner_tx, owner_new_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.uuid_id = v_existing_in;
    owner_transaction_id := v_owner_tx;
    transaction_id := COALESCE(v_existing_out, v_owner_tx);
    IF v_existing_out IS NOT NULL THEN
      SELECT w.balance INTO payer_new_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.id = t.wallet_id
      WHERE t.uuid_id = v_existing_out;
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock the link row: serializes settlements per link (counters, cap,
  -- and on-demand wallet creation stay race-free).
  SELECT * INTO v_link FROM public.payment_links
  WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;
  IF v_link.status <> 'active' THEN
    RAISE EXCEPTION 'Payment link is not active';
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'Payment link has expired';
  END IF;
  IF v_link.max_payments IS NOT NULL
     AND COALESCE(v_link.payment_count, 0) >= v_link.max_payments THEN
    RAISE EXCEPTION 'Payment link has reached its payment limit';
  END IF;
  IF v_link.amount IS NOT NULL AND p_amount <> v_link.amount THEN
    RAISE EXCEPTION 'This link requires payment of exactly % %',
      v_link.amount, v_link.currency;
  END IF;
  IF p_payer_user_id IS NOT NULL AND p_payer_user_id = v_link.user_id THEN
    RAISE EXCEPTION 'The link owner cannot pay their own payment link';
  END IF;

  -- Settlement target account (NULL = Main). Must be the owner's own
  -- account and must not be closed (frozen may receive, never send).
  IF v_link.account_id IS NOT NULL THEN
    SELECT * INTO v_account FROM public.accounts WHERE id = v_link.account_id;
    IF v_account.id IS NULL OR v_account.user_id <> v_link.user_id THEN
      RAISE EXCEPTION 'Settlement account is invalid for this link';
    END IF;
    IF v_account.status = 'closed' THEN
      RAISE EXCEPTION 'Settlement account is closed and cannot receive payments';
    END IF;
  END IF;

  -- Owner's wallet for (target account, link currency) — created on
  -- demand, as execute_atomic_transfer does for transfer recipients.
  SELECT * INTO v_owner_wallet FROM public.wallets
  WHERE user_id = v_link.user_id
    AND currency = v_link.currency
    AND account_id IS NOT DISTINCT FROM v_link.account_id
  FOR UPDATE;
  IF v_owner_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
    VALUES (v_link.user_id, v_link.account_id, v_link.currency, 0, 'active')
    RETURNING * INTO v_owner_wallet;
  END IF;
  IF v_owner_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Settlement wallet is not active';
  END IF;

  -- Wallet payment: debit the payer's Main wallet in the link currency.
  IF p_payer_user_id IS NOT NULL THEN
    SELECT * INTO v_payer_wallet FROM public.wallets
    WHERE user_id = p_payer_user_id
      AND currency = v_link.currency
      AND account_id IS NULL
    FOR UPDATE;
    IF v_payer_wallet.id IS NULL THEN
      RAISE EXCEPTION 'No % wallet found for the payer', v_link.currency;
    END IF;
    IF v_payer_wallet.status <> 'active' THEN
      RAISE EXCEPTION 'Payer wallet is not active';
    END IF;
    IF v_payer_wallet.balance < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance: have %, need %',
        v_payer_wallet.balance, p_amount;
    END IF;

    UPDATE public.wallets
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_payer_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_payer_user_id, v_payer_wallet.id, p_amount, v_link.currency,
       'outgoing', p_payment_method, 'completed', v_link.title,
       COALESCE(p_description, 'Payment link: ' || v_link.title),
       'link:' || v_link.id::text, 'payment_link', p_idempotency_key)
    RETURNING uuid_id INTO v_payer_tx;
    payer_new_balance := v_payer_wallet.balance - p_amount;
  END IF;

  -- Credit the owner and ledger their leg.
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_owner_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_link.user_id, v_owner_wallet.id, p_amount, v_link.currency,
     'incoming', p_payment_method, 'completed',
     COALESCE(p_description, 'Payment link: ' || v_link.title),
     'link:' || v_link.id::text, 'payment_link', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_owner_tx;

  -- Counters accumulate server-side, in the same transaction.
  UPDATE public.payment_links
  SET payment_count = COALESCE(payment_count, 0) + 1,
      total_collected = COALESCE(total_collected, 0) + p_amount,
      updated_at = now()
  WHERE id = v_link.id;

  v_owner_balance := v_owner_wallet.balance + p_amount;

  -- Owner's display name for the fee and split ledger rows (may be NULL).
  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_owner_name
  FROM public.profiles p
  WHERE p.id = v_link.user_id;

  -- ── Platform fee ────────────────────────────────────────────────────
  -- BMaGlass Pay's cut of this settlement, taken FIRST — before the
  -- owner's split rules run. Skipped legs leave v_platform_fee at 0
  -- and the share stays with the owner.
  v_fee_rate := COALESCE(
    (SELECT split_platform_fee_percent FROM public.platform_settings WHERE id),
    2.5);
  IF v_fee_rate > 0 THEN
    v_platform_fee := LEAST(round(p_amount * v_fee_rate / 100, 2), p_amount);
  END IF;

  IF v_platform_fee > 0 THEN
    -- The platform operator: earliest-created admin.
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;

    IF v_platform_user IS NULL OR v_platform_user = v_link.user_id THEN
      -- No platform operator yet, or the owner IS the platform: no fee.
      v_platform_fee := 0;
    ELSE
      -- Platform's Main wallet in the settlement currency, created on
      -- demand. A closed wallet cannot receive — the leg is skipped;
      -- frozen may receive.
      SELECT * INTO v_platform_wallet FROM public.wallets
      WHERE user_id = v_platform_user
        AND currency = v_link.currency
        AND account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet.id IS NULL THEN
        INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
        VALUES (v_platform_user, NULL, v_link.currency, 0, 'active')
        RETURNING * INTO v_platform_wallet;
      END IF;

      IF v_platform_wallet.status = 'closed' THEN
        v_platform_fee := 0;
      ELSE
        -- Move the fee: owner settlement wallet → platform Main wallet.
        UPDATE public.wallets
        SET balance = balance - v_platform_fee, updated_at = now()
        WHERE id = v_owner_wallet.id;
        UPDATE public.wallets
        SET balance = balance + v_platform_fee, updated_at = now()
        WHERE id = v_platform_wallet.id;

        INSERT INTO public.transactions
          (user_id, wallet_id, amount, currency, direction, payment_method,
           status, recipient_name, description, reference, category, idempotency_key)
        VALUES
          (v_link.user_id, v_owner_wallet.id, v_platform_fee, v_link.currency,
           'outgoing', p_payment_method, 'completed', 'BMaGlass Pay',
           'Platform fee — payment link: ' || v_link.title,
           'link:' || v_link.id::text, 'platform_fee',
           p_idempotency_key || ':platform_fee:out');

        INSERT INTO public.transactions
          (user_id, wallet_id, amount, currency, direction, payment_method,
           status, recipient_name, description, reference, category, idempotency_key)
        VALUES
          (v_platform_user, v_platform_wallet.id, v_platform_fee, v_link.currency,
           'incoming', p_payment_method, 'completed', v_owner_name,
           'Platform fee — payment link: ' || v_link.title,
           'link:' || v_link.id::text, 'platform_fee',
           p_idempotency_key || ':platform_fee:in');

        v_owner_balance := v_owner_balance - v_platform_fee;
      END IF;
    END IF;
  END IF;

  -- ── Split execution ─────────────────────────────────────────────────
  -- The owner's active rules divert shares of this payment to split
  -- recipients. With no active rules this loop finds no rows and the
  -- settlement is exactly what it was before splits executed. The
  -- remainder starts AFTER the platform fee: legs are still shares of
  -- the ORIGINAL payment amount, capped at what the fee left behind.
  v_remaining := p_amount - v_platform_fee;

  FOR v_rule IN
    SELECT r.id AS rule_id, r.name AS rule_name,
           r.split_type, r.split_value,
           s.id AS subaccount_id, s.account_name,
           s.account_email
    FROM public.split_rules r
    JOIN public.subaccounts s ON s.id = r.subaccount_id
    WHERE r.owner_id = v_link.user_id
      AND s.owner_id = v_link.user_id
      AND r.is_active
      AND s.status = 'active'
      AND r.split_value > 0
    ORDER BY r.created_at, r.id
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Leg size: percentage legs are shares of the ORIGINAL amount;
    -- every leg is capped at what remains of the payment.
    IF v_rule.split_type = 'percentage' THEN
      v_leg := round(p_amount * v_rule.split_value / 100, 2);
    ELSE
      v_leg := v_rule.split_value;
    END IF;
    v_leg := LEAST(v_leg, v_remaining);
    IF v_leg <= 0 THEN
      CONTINUE;
    END IF;

    -- Resolve the recipient to a platform user by account email.
    -- No email / no account under that email / the owner themselves:
    -- the leg does not execute and the share stays with the owner.
    IF v_rule.account_email IS NULL
       OR btrim(v_rule.account_email) = '' THEN
      CONTINUE;
    END IF;
    SELECT u.id INTO v_recipient_user
    FROM auth.users u
    WHERE lower(u.email) = lower(btrim(v_rule.account_email))
    ORDER BY u.created_at
    LIMIT 1;
    IF v_recipient_user IS NULL OR v_recipient_user = v_link.user_id THEN
      CONTINUE;
    END IF;

    -- Recipient's Main wallet in the settlement currency, created on
    -- demand. A closed wallet cannot receive — the leg is skipped and
    -- the share stays with the owner; frozen may receive.
    SELECT * INTO v_recipient_wallet FROM public.wallets
    WHERE user_id = v_recipient_user
      AND currency = v_link.currency
      AND account_id IS NULL
    FOR UPDATE;
    IF v_recipient_wallet.id IS NULL THEN
      INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
      VALUES (v_recipient_user, NULL, v_link.currency, 0, 'active')
      RETURNING * INTO v_recipient_wallet;
    END IF;
    IF v_recipient_wallet.status = 'closed' THEN
      CONTINUE;
    END IF;

    -- Move the leg: owner settlement wallet → recipient Main wallet.
    UPDATE public.wallets
    SET balance = balance - v_leg, updated_at = now()
    WHERE id = v_owner_wallet.id;
    UPDATE public.wallets
    SET balance = balance + v_leg, updated_at = now()
    WHERE id = v_recipient_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_link.user_id, v_owner_wallet.id, v_leg, v_link.currency,
       'outgoing', p_payment_method, 'completed', v_rule.account_name,
       'Split payment: ' || v_rule.rule_name || ' → ' || v_rule.account_name,
       'link:' || v_link.id::text, 'split_payment',
       p_idempotency_key || ':split:' || v_rule.rule_id::text || ':out');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_recipient_user, v_recipient_wallet.id, v_leg, v_link.currency,
       'incoming', p_payment_method, 'completed', v_owner_name,
       'Split payment: ' || v_rule.rule_name
         || ' (payment link: ' || v_link.title || ')',
       'link:' || v_link.id::text, 'split_payment',
       p_idempotency_key || ':split:' || v_rule.rule_id::text || ':in');

    UPDATE public.subaccounts
    SET total_received = COALESCE(total_received, 0) + v_leg,
        updated_at = now()
    WHERE id = v_rule.subaccount_id;

    v_owner_balance := v_owner_balance - v_leg;
    v_remaining := v_remaining - v_leg;
  END LOOP;

  transaction_id := COALESCE(v_payer_tx, v_owner_tx);
  owner_transaction_id := v_owner_tx;
  owner_new_balance := v_owner_balance;
  RETURN NEXT;
END;
$$;

-- Only the service role (the payment-link-checkout edge function) may
-- execute this — the same grant pattern as before.
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) TO service_role;
