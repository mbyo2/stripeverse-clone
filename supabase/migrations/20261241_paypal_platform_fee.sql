-- PayPal platform fee = 1% (CEO decision 2026-10-28 00:03 CAT:
-- "Set our PayPal fee to 1%").
--
-- Until now the PayPal rail had no rate of its own:
--   - A payment link settled with external PayPal money
--     (execute_payment_link_settlement, p_payment_method =
--     'paypal') was charged the generic payment-link rate,
--     platform_settings.split_platform_fee_percent (2.5%) — the
--     rate set for wallet/Bitcoin link settlements.
--   - A PayPal checkout payment (process-payment → capture →
--     complete_checkout_payment, the hosted-checkout / embed /
--     plugin collection path) was charged NO platform fee at all
--     (deliberate in 20261022, when no PayPal rate existed).
-- The CEO priced the PayPal take at 1% — PayPal's own processing
-- fee (~3.49% + $0.49) plus our 1% — so merchants collecting
-- through our plugins / SDKs / links are not pushed to wire
-- PayPal in directly. This migration gives the PayPal rail its
-- own rate and applies it on both merchant-collection paths:
--
--   1. platform_settings.paypal_platform_fee_percent (new,
--      default 1) — the PayPal rail rate, sibling of
--      paypal_payout_fee_percent (withdrawals, a separate rate,
--      0 today and NOT changed by this migration).
--   2. execute_payment_link_settlement (body = 20261216 verbatim
--      except the marked lines): the fee rate resolves PER RAIL —
--      'paypal' → paypal_platform_fee_percent; every other method
--      (wallet, Bitcoin) → split_platform_fee_percent, unchanged.
--      The resolved rate is stamped into the settlement's fee
--      metadata ('fee_rate_percent'). Fee-bearer semantics,
--      splits, provenance and idempotency are untouched; the
--      return shape is unchanged, so CREATE OR REPLACE preserves
--      the existing service_role-only ACL.
--   3. complete_checkout_payment (body = 20261028 verbatim except
--      the marked 20261241 blocks): gains the platform fee leg.
--      Seller-bears (a checkout has no fee-bearer choice — the
--      buyer paid the exact recorded amount at PayPal): the fee
--      is resolved before the credit (same rule, same skip rules
--      as the link settlement: rate <= 0, no platform operator,
--      merchant IS the operator, platform wallet closed), the
--      merchant is credited the gross amount and the fee then
--      moves merchant → platform with the same ledger rows the
--      link settlement writes (category 'platform_fee'), all
--      inside the same locked transaction — exactly-once covers
--      the fee, replays move nothing twice. The settlement row's
--      metadata gains platform_fee_amount /
--      platform_fee_rate_percent / net_credited, and the PayPal
--      provenance mark now covers what the merchant actually
--      received (gross − fee): the fee leg carries no mark,
--      exactly as the link settlement's fee leg gets none.
--      Reversal symmetry (20261227) is preserved: reverse_
--      paypal_credit still caps at the recorded gross amount and
--      at the wallet balance, so a reversed capture claws back
--      what stands — the platform fee is not refunded on a
--      reversal (the Stripe/PayPal industry rule), and any
--      shortfall is recorded, never a negative balance.
--
-- Audited and deliberately NOT changed (no platform fee exists
-- on these PayPal flows today, and this decision re-rates the
-- collection take — it does not invent new charges):
--   - PayPal wallet deposits (complete_wallet_deposit): feeless
--     by design — a user funding their own wallet.
--   - PayPal withdrawals: paypal_payout_fee_percent stays 0.
--   - Invoices / payment requests (20261204): internal wallet
--     settlements, feeless by design; not PayPal-railed.
--   - paypal-marketplace: deprecated endpoint, settles nothing.
--   - Send 2.5% / Transfer 1.5% / P2P 0.5% / BTC buy-sell 1.5% /
--     BTC + wallet payment-link 2.5% / card funding 1% min K2:
--     all untouched.

-- ── 1. The PayPal rail rate ─────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS paypal_platform_fee_percent numeric NOT NULL DEFAULT 1;

-- ── 2. Payment-link settlement: per-rail fee rate ───────────────
CREATE OR REPLACE FUNCTION public.execute_payment_link_settlement(p_link_id uuid, p_payer_user_id uuid, p_amount numeric, p_idempotency_key text, p_payment_method text DEFAULT 'wallet'::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, owner_transaction_id uuid, owner_new_balance numeric, payer_new_balance numeric, fee_amount numeric, fee_payer text, total_charged numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.payment_links;
  v_account public.accounts;
  v_owner_wallet public.wallets;
  v_payer_wallet public.wallets;
  v_existing_in uuid;
  v_existing_out uuid;
  v_existing_ref text;
  v_owner_tx uuid;
  v_payer_tx uuid;
  -- Platform fee state.
  v_fee_rate numeric;             -- per-rail rate (PayPal 1% / link 2.5%)
  v_platform_fee numeric := 0;    -- fee actually taken (0 when the leg is skipped)
  v_platform_user uuid;           -- platform operator (earliest-created admin)
  v_platform_wallet public.wallets;
  v_fee_payer text := 'seller';   -- the link's fee-bearer (seller | buyer)
  v_buyer_total numeric := 0;     -- total the buyer pays (price + fee when buyer-pays)
  v_fee_meta jsonb;               -- fee truth stamped on the settlement ledger rows
  v_payer_name text;              -- payer display name (buyer-mode fee rows)
  v_replay_fee numeric;           -- fee found on an idempotent replay
  -- Split execution state.
  v_owner_balance numeric;        -- owner's balance after the gross credit
  v_remaining numeric;            -- undiverted remainder of the payment
  v_rule record;
  v_recipient_user uuid;
  v_recipient_wallet public.wallets;
  v_leg numeric;
  v_owner_name text;
  -- Provenance distribution state (20261028): the settlement's user
  -- legs are collected as they execute and the payer's mark (or the
  -- fresh PayPal money) is distributed over them at the end.
  v_taint_users uuid[] := '{}';
  v_taint_amounts numeric[] := '{}';
  v_taint_shares numeric[] := '{}';
  v_taint_total numeric := 0;
  v_taint_share numeric := 0;
  v_taint_assigned numeric := 0;
  v_largest_idx integer := 1;
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
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a settled link payment always leaves exactly one owner
  -- incoming row keyed <key>:in. A replay returns the original result.
  -- L2 scope: the replay is honoured only for THIS link -- the stored
  -- rows carry reference 'link:' || p_link_id. The same key found under
  -- a different reference belongs to a different settlement and is
  -- rejected, so a leaked key cannot harvest another link's balances
  -- or fake an 'already processed' result for it.
  SELECT t.uuid_id, t.reference INTO v_existing_in, v_existing_ref
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key || ':in'
    AND t.direction = 'incoming'
  LIMIT 1;
  IF v_existing_in IS NOT NULL
     AND v_existing_ref IS DISTINCT FROM 'link:' || p_link_id::text THEN
    RAISE EXCEPTION 'Idempotency key already used';
  END IF;
  IF v_existing_in IS NULL THEN
    SELECT t.reference INTO v_existing_ref
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    IF v_existing_ref IS NOT NULL
       AND v_existing_ref IS DISTINCT FROM 'link:' || p_link_id::text THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
  END IF;
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
    -- Fee-bearer truth for the replayed result: the link's stored
    -- choice, plus the fee the original settlement actually took
    -- (its platform fee-in row exists exactly when the fee leg ran).
    SELECT pl.fee_payer INTO v_fee_payer
    FROM public.payment_links pl WHERE pl.id = p_link_id;
    v_fee_payer := COALESCE(v_fee_payer, 'seller');
    SELECT t.amount INTO v_replay_fee
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':platform_fee:in'
    LIMIT 1;
    fee_amount := COALESCE(v_replay_fee, 0);
    fee_payer := v_fee_payer;
    total_charged := p_amount
      + CASE WHEN v_fee_payer = 'buyer' THEN COALESCE(v_replay_fee, 0) ELSE 0 END;
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

  -- The link's fee-bearer — resolved when the link was created
  -- (per-link choice > merchant account default > platform default
  -- 'seller'), stored on the link, and enforced here: no caller can
  -- change who bears the fee at pay time.
  v_fee_payer := COALESCE(v_link.fee_payer, 'seller');

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

  -- ── Platform fee pre-resolution ─────────────────────────────────
  -- The fee rule is unchanged: the per-rail rate resolved just
  -- below, of the payment amount, rounded half-up to whole ngwee
  -- (round(x, 2) on numeric), capped at the payment amount. The
  -- fee-bearer decides WHO funds the fee, and that decides the
  -- payer's debit total, so the fee is fully resolved — rate, amount,
  -- skip rules, platform wallet — BEFORE any wallet moves:
  --   seller-pays → the payer is debited the price; the fee leaves
  --     the owner's credit in the fee step below (the original flow).
  --   buyer-pays  → the payer is debited price + fee; the owner
  --     keeps the full price; the fee settles payer → platform.
  -- Skip rules (the fee ends at 0): rate <= 0, no platform operator
  -- yet, the owner IS the platform operator, or the platform wallet
  -- is closed. A frozen platform wallet may still receive.
  -- Per-rail rate (CEO decision 2026-10-28): an external PayPal
  -- settlement (p_payment_method = 'paypal' — the gateway
  -- completion path) carries the PayPal platform fee,
  -- platform_settings.paypal_platform_fee_percent (1%); every
  -- other method (wallet, Bitcoin) keeps the payment-link rate,
  -- platform_settings.split_platform_fee_percent (2.5%).
  v_fee_rate := COALESCE(
    (SELECT CASE WHEN lower(COALESCE(p_payment_method, '')) = 'paypal'
                 THEN paypal_platform_fee_percent
                 ELSE split_platform_fee_percent END
     FROM public.platform_settings WHERE id),
    CASE WHEN lower(COALESCE(p_payment_method, '')) = 'paypal'
         THEN 1 ELSE 2.5 END);
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
      v_platform_user := NULL;
    ELSE
      -- Platform's Main wallet in the settlement currency, created on
      -- demand (as the original fee step did). A closed wallet cannot
      -- receive — the leg is skipped; frozen may receive.
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
      END IF;
    END IF;
  END IF;

  -- What the buyer pays in total. Seller-pays: the price alone — the
  -- payer debit below is then exactly what it has always been.
  v_buyer_total := p_amount
    + CASE WHEN v_fee_payer = 'buyer' THEN v_platform_fee ELSE 0 END;

  -- The fee truth stamped on this settlement's ledger rows, so the
  -- payer, the owner and the platform all read the same figures.
  v_fee_meta := jsonb_build_object(
    'fee_payer', v_fee_payer,
    'fee_amount', v_platform_fee,
    'fee_rate_percent', v_fee_rate,
    'price_amount', p_amount,
    'total_charged', v_buyer_total);

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
    IF v_payer_wallet.balance < v_buyer_total THEN
      RAISE EXCEPTION 'Insufficient balance: have %, need %',
        v_payer_wallet.balance, v_buyer_total;
    END IF;

    UPDATE public.wallets
    SET balance = balance - v_buyer_total, updated_at = now()
    WHERE id = v_payer_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key, metadata)
    VALUES
      (p_payer_user_id, v_payer_wallet.id, p_amount, v_link.currency,
       'outgoing', p_payment_method, 'completed', v_link.title,
       COALESCE(p_description, 'Payment link: ' || v_link.title),
       'link:' || v_link.id::text, 'payment_link', p_idempotency_key,
       v_fee_meta)
    RETURNING uuid_id INTO v_payer_tx;
    payer_new_balance := v_payer_wallet.balance - v_buyer_total;
  END IF;

  -- Credit the owner and ledger their leg.
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_owner_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key, metadata)
  VALUES
    (v_link.user_id, v_owner_wallet.id, p_amount, v_link.currency,
     'incoming', p_payment_method, 'completed',
     COALESCE(p_description, 'Payment link: ' || v_link.title),
     'link:' || v_link.id::text, 'payment_link', p_idempotency_key || ':in',
     v_fee_meta)
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

  -- ── Platform fee execution ────────────────────────────────────
  -- The fee was resolved before the payer debit (rate, amount, skip
  -- rules, platform wallet). Only the movement remains, and it
  -- follows the fee-bearer:
  --   seller-pays → owner settlement wallet → platform Main wallet:
  --     exactly the original movement, ledger rows included.
  --   buyer-pays with a wallet payer → the fee already left the
  --     payer inside the debit total; credit the platform and ledger
  --     the payer's fee leg. The owner's credit is never touched, so
  --     the owner receives the full price.
  --   buyer-pays with an external payer (a gateway's credit-only
  --     leg) → the gateway collected price + fee outside the
  --     wallets; credit the platform its share. No wallet funded it
  --     here, so there is no fee-out row.
  IF v_platform_fee > 0 THEN
    IF v_fee_payer = 'buyer' AND p_payer_user_id IS NOT NULL THEN
      -- Payer's display name for the platform's incoming row.
      SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
      INTO v_payer_name
      FROM public.profiles p
      WHERE p.id = p_payer_user_id;

      UPDATE public.wallets
      SET balance = balance + v_platform_fee, updated_at = now()
      WHERE id = v_platform_wallet.id;

      INSERT INTO public.transactions
        (user_id, wallet_id, amount, currency, direction, payment_method,
         status, recipient_name, description, reference, category, idempotency_key, metadata)
      VALUES
        (p_payer_user_id, v_payer_wallet.id, v_platform_fee, v_link.currency,
         'outgoing', p_payment_method, 'completed', 'BMaGlass Pay',
         'Platform fee — payment link: ' || v_link.title,
         'link:' || v_link.id::text, 'platform_fee',
         p_idempotency_key || ':platform_fee:out', v_fee_meta);

      INSERT INTO public.transactions
        (user_id, wallet_id, amount, currency, direction, payment_method,
         status, recipient_name, description, reference, category, idempotency_key, metadata)
      VALUES
        (v_platform_user, v_platform_wallet.id, v_platform_fee, v_link.currency,
         'incoming', p_payment_method, 'completed', v_payer_name,
         'Platform fee — payment link: ' || v_link.title,
         'link:' || v_link.id::text, 'platform_fee',
         p_idempotency_key || ':platform_fee:in', v_fee_meta);
    ELSIF v_fee_payer = 'buyer' THEN
      UPDATE public.wallets
      SET balance = balance + v_platform_fee, updated_at = now()
      WHERE id = v_platform_wallet.id;

      INSERT INTO public.transactions
        (user_id, wallet_id, amount, currency, direction, payment_method,
         status, recipient_name, description, reference, category, idempotency_key, metadata)
      VALUES
        (v_platform_user, v_platform_wallet.id, v_platform_fee, v_link.currency,
         'incoming', p_payment_method, 'completed', NULL,
         'Platform fee — payment link: ' || v_link.title,
         'link:' || v_link.id::text, 'platform_fee',
         p_idempotency_key || ':platform_fee:in', v_fee_meta);
    ELSE
      -- Seller-pays: the original movement — owner → platform.
      UPDATE public.wallets
      SET balance = balance - v_platform_fee, updated_at = now()
      WHERE id = v_owner_wallet.id;
      UPDATE public.wallets
      SET balance = balance + v_platform_fee, updated_at = now()
      WHERE id = v_platform_wallet.id;

      INSERT INTO public.transactions
        (user_id, wallet_id, amount, currency, direction, payment_method,
         status, recipient_name, description, reference, category, idempotency_key, metadata)
      VALUES
        (v_link.user_id, v_owner_wallet.id, v_platform_fee, v_link.currency,
         'outgoing', p_payment_method, 'completed', 'BMaGlass Pay',
         'Platform fee — payment link: ' || v_link.title,
         'link:' || v_link.id::text, 'platform_fee',
         p_idempotency_key || ':platform_fee:out', v_fee_meta);

      INSERT INTO public.transactions
        (user_id, wallet_id, amount, currency, direction, payment_method,
         status, recipient_name, description, reference, category, idempotency_key, metadata)
      VALUES
        (v_platform_user, v_platform_wallet.id, v_platform_fee, v_link.currency,
         'incoming', p_payment_method, 'completed', v_owner_name,
         'Platform fee — payment link: ' || v_link.title,
         'link:' || v_link.id::text, 'platform_fee',
         p_idempotency_key || ':platform_fee:in', v_fee_meta);

      v_owner_balance := v_owner_balance - v_platform_fee;
    END IF;

    -- Provenance (20261028): collect the fee leg for the
    -- end-of-settlement distribution (its share of a moved mark
    -- is destroyed; fresh PayPal money gives it none).
    v_taint_users := array_append(v_taint_users, NULL::uuid);
    v_taint_amounts := array_append(v_taint_amounts, v_platform_fee);
  END IF;

  -- ── Split execution ─────────────────────────────────────────────────
  -- The owner's active rules divert shares of this payment to split
  -- recipients. With no active rules this loop finds no rows and the
  -- settlement is exactly what it was before splits executed. The
  -- remainder starts AFTER the platform fee: legs are still shares of
  -- the ORIGINAL payment amount, capped at what the fee left behind.
  -- Seller-pays: the fee already left the owner's side, so splits
  -- divide what remains of the price. Buyer-pays: the owner kept the
  -- full price, so splits divide the full price.
  v_remaining := p_amount
    - CASE WHEN v_fee_payer = 'seller' THEN v_platform_fee ELSE 0 END;

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
    -- Provenance (20261028): collect this executed split leg.
    v_taint_users := array_append(v_taint_users, v_recipient_user);
    v_taint_amounts := array_append(v_taint_amounts, v_leg);
    v_remaining := v_remaining - v_leg;
  END LOOP;

  -- ── Provenance distribution (20261028) ─────────────────────────
  -- The collected legs — platform fee, each executed split leg, and
  -- the owner's residual appended here — sum to v_buyer_total
  -- exactly (the price alone when the seller bears the fee; price +
  -- fee when the buyer does).
  IF v_remaining > 0 THEN
    v_taint_users := array_append(v_taint_users, v_link.user_id);
    v_taint_amounts := array_append(v_taint_amounts, v_remaining);
  END IF;

  IF array_length(v_taint_amounts, 1) IS NOT NULL THEN
    IF p_payer_user_id IS NOT NULL THEN
      -- Wallet-paid: the payer's mark moves spent-first and is
      -- distributed across the legs PRO-RATA by leg amount. Per-leg
      -- shares are rounded to 2dp and the rounding residue lands on
      -- the largest leg, so the distributed mark equals the moved
      -- mark to the cent. The fee leg's share is destroyed (its
      -- "recipient" is NULL — the mark simply never lands anywhere).
      v_taint_total := public.paypal_taint_debit(
        p_payer_user_id, v_link.currency, v_buyer_total);
      IF v_taint_total > 0 THEN
        FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
          v_taint_share := round(
            v_taint_total * v_taint_amounts[i] / v_buyer_total, 2);
          v_taint_shares := array_append(v_taint_shares, v_taint_share);
          v_taint_assigned := v_taint_assigned + v_taint_share;
          IF v_taint_amounts[i] > v_taint_amounts[v_largest_idx] THEN
            v_largest_idx := i;
          END IF;
        END LOOP;
        v_taint_shares[v_largest_idx] := GREATEST(0,
          v_taint_shares[v_largest_idx]
            + (v_taint_total - v_taint_assigned));
        FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
          IF v_taint_users[i] IS NOT NULL AND v_taint_shares[i] > 0 THEN
            PERFORM public.paypal_taint_credit(
              v_taint_users[i], v_link.currency, v_taint_shares[i]);
          END IF;
        END LOOP;
      END IF;
    ELSIF lower(COALESCE(p_payment_method, '')) = 'paypal' THEN
      -- External PayPal payment (the gateway completion path): the
      -- whole settled amount is FRESH PayPal money, so every user
      -- leg is marked in full by its amount; the fee leg gets none.
      FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
        IF v_taint_users[i] IS NOT NULL THEN
          PERFORM public.paypal_taint_credit(
            v_taint_users[i], v_link.currency, v_taint_amounts[i]);
        END IF;
      END LOOP;
    END IF;
  END IF;

  transaction_id := COALESCE(v_payer_tx, v_owner_tx);
  owner_transaction_id := v_owner_tx;
  owner_new_balance := v_owner_balance;
  fee_amount := v_platform_fee;
  fee_payer := v_fee_payer;
  total_charged := v_buyer_total;
  RETURN NEXT;
END;
$function$;

-- Return shape unchanged → the existing grants are preserved by
-- CREATE OR REPLACE (service_role execute only, as today).

-- ── 3. Checkout completion: the 1% PayPal platform fee leg ──────
CREATE OR REPLACE FUNCTION public.complete_checkout_payment(
  p_order_id text,
  p_capture_id text,
  p_captured_amount numeric,
  p_captured_currency text
)
RETURNS TABLE(
  outcome text,
  transaction_id uuid,
  wallet_id uuid,
  credited_amount numeric,
  currency text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.transactions;
  v_wallet public.wallets;
  -- Platform fee state (CEO decision 2026-10-28: the PayPal rail
  -- carries a 1% platform fee — platform_settings.
  -- paypal_platform_fee_percent).
  v_fee_rate numeric;
  v_platform_fee numeric := 0;
  v_platform_user uuid;
  v_platform_wallet public.wallets;
  v_merchant_name text;
BEGIN
  IF p_order_id IS NULL OR length(p_order_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal order id is required';
  END IF;
  IF p_capture_id IS NULL OR length(p_capture_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal capture id is required';
  END IF;
  IF p_captured_amount IS NULL OR p_captured_amount <= 0 THEN
    RAISE EXCEPTION 'Captured amount must be greater than zero';
  END IF;
  IF p_captured_currency IS NULL OR length(p_captured_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid captured currency is required';
  END IF;

  -- Lock the checkout row: the status check and the credit below are
  -- one atomic unit, which is what makes completion exactly-once.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.reference = p_order_id
    AND t.payment_method = 'paypal'
    AND t.metadata ->> 'kind' = 'checkout_payment'
  ORDER BY t.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  transaction_id := v_tx.uuid_id;
  wallet_id := v_tx.wallet_id;
  credited_amount := v_tx.amount;
  currency := v_tx.currency;

  IF v_tx.status = 'completed' THEN
    IF v_tx.external_reference = p_capture_id
       OR v_tx.metadata ->> 'capture_id' = p_capture_id THEN
      outcome := 'already_completed';
    ELSE
      outcome := 'conflict';
    END IF;
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Defence in depth: this capture already funded another checkout
  -- payment.
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.external_reference = p_capture_id
      AND t.status = 'completed'
      AND t.metadata ->> 'kind' = 'checkout_payment'
      AND t.uuid_id <> v_tx.uuid_id
  ) THEN
    outcome := 'already_completed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_tx.status <> 'pending' THEN
    outcome := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Verify the capture against the recorded checkout amount. A
  -- mismatch is a hard stop: no state changes, no credit, the outcome
  -- names itself.
  IF round(p_captured_amount, 2) <> round(v_tx.amount, 2) THEN
    outcome := 'amount_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;
  IF upper(p_captured_currency) <> upper(v_tx.currency) THEN
    outcome := 'currency_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.status = 'closed' THEN
    outcome := 'wallet_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── Platform fee pre-resolution (20261241) ───────────────────
  -- The PayPal platform fee: platform_settings.
  -- paypal_platform_fee_percent (1%) of the payment amount,
  -- rounded half-up to whole ngwee, capped at the payment amount
  -- — the same fee rule the payment-link settlement charges.
  -- Skip rules mirror the link settlement: rate <= 0, no platform
  -- operator yet, the merchant IS the platform operator, or the
  -- platform wallet is closed (a frozen platform wallet may still
  -- receive). Resolved before the credit so the settlement row can
  -- carry the fee truth in its metadata.
  v_fee_rate := COALESCE(
    (SELECT paypal_platform_fee_percent FROM public.platform_settings WHERE id),
    1);
  IF v_fee_rate > 0 THEN
    v_platform_fee := LEAST(round(v_tx.amount * v_fee_rate / 100, 2), v_tx.amount);
  END IF;
  IF v_platform_fee > 0 THEN
    -- The platform operator: earliest-created admin (the same
    -- resolution the payment-link settlement uses).
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;

    IF v_platform_user IS NULL OR v_platform_user = v_tx.user_id THEN
      v_platform_fee := 0;
      v_platform_user := NULL;
    ELSE
      -- (Aliased: this function's OUT parameter `currency` makes a
      -- bare currency column reference ambiguous — 42702.)
      SELECT * INTO v_platform_wallet FROM public.wallets pw
      WHERE pw.user_id = v_platform_user
        AND pw.currency = v_tx.currency
        AND pw.account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet.id IS NULL THEN
        INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
        VALUES (v_platform_user, NULL, v_tx.currency, 0, 'active')
        RETURNING * INTO v_platform_wallet;
      END IF;
      IF v_platform_wallet.status = 'closed' THEN
        v_platform_fee := 0;
      END IF;
    END IF;
  END IF;

  UPDATE public.wallets w
  SET balance = w.balance + v_tx.amount,
      updated_at = now()
  WHERE w.id = v_wallet.id
  RETURNING w.balance INTO new_balance;

  UPDATE public.transactions t
  SET status = 'completed',
      external_reference = p_capture_id,
      description = 'Checkout payment via PayPal',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'capture_id', p_capture_id,
        'captured_amount', p_captured_amount,
        'captured_currency', upper(p_captured_currency),
        'captured_at', now(),
        'platform_fee_amount', v_platform_fee,
        'platform_fee_rate_percent', v_fee_rate,
        'net_credited', v_tx.amount - v_platform_fee
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  -- ── Platform fee execution (20261241) ────────────────────────
  -- Seller-bears: a checkout has no fee-bearer choice — the buyer
  -- paid the exact recorded amount at PayPal — so the fee leaves
  -- the merchant's credit and lands with the platform operator,
  -- ledgered exactly as the payment-link settlement ledgers its
  -- seller-pays fee (same category, same row shapes). The whole
  -- movement happens inside this transaction, under the row lock,
  -- so the exactly-once guarantee covers the fee too: a replay
  -- returns above and moves nothing twice.
  IF v_platform_fee > 0 THEN
    SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    INTO v_merchant_name
    FROM public.profiles p
    WHERE p.id = v_tx.user_id;

    UPDATE public.wallets w
    SET balance = w.balance - v_platform_fee,
        updated_at = now()
    WHERE w.id = v_wallet.id
    RETURNING w.balance INTO new_balance;

    UPDATE public.wallets w
    SET balance = w.balance + v_platform_fee,
        updated_at = now()
    WHERE w.id = v_platform_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key, metadata)
    VALUES
      (v_tx.user_id, v_wallet.id, v_platform_fee, v_tx.currency,
       'outgoing', 'paypal', 'completed', 'BMaGlass Pay',
       'Platform fee — PayPal checkout payment',
       v_tx.reference, 'platform_fee',
       'checkout:' || v_tx.uuid_id::text || ':platform_fee:out',
       jsonb_build_object(
         'kind', 'checkout_payment',
         'fee_rate_percent', v_fee_rate,
         'gross_amount', v_tx.amount));

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key, metadata)
    VALUES
      (v_platform_user, v_platform_wallet.id, v_platform_fee, v_tx.currency,
       'incoming', 'paypal', 'completed', v_merchant_name,
       'Platform fee — PayPal checkout payment',
       v_tx.reference, 'platform_fee',
       'checkout:' || v_tx.uuid_id::text || ':platform_fee:in',
       jsonb_build_object(
         'kind', 'checkout_payment',
         'fee_rate_percent', v_fee_rate,
         'gross_amount', v_tx.amount));
  END IF;

  -- Provenance (20261028): a verified PayPal capture creates the
  -- mark for the merchant, exactly as a deposit does for its owner —
  -- this money arrived via PayPal and keeps that right as it moves.
  -- Only on the credited path (replays return above). Since
  -- 20261241 the mark covers what the merchant actually received
  -- (gross minus the platform fee): the fee leg carries no mark,
  -- exactly as the payment-link settlement's fee leg gets none.
  PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount - v_platform_fee);

  outcome := 'credited';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) TO service_role;
