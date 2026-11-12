-- 20261263 — Automatic collection of the 1% mobile-money service
-- charges (CEO, 2026-11-12: "collect the 1% charges from the
-- merchant's wallet automatically").
--
-- Before this migration the 1% charge written by
-- settle_momo_collection was a recorded receivable forever: the
-- status CHECK allowed only 'recorded', and no code path ever
-- debited a wallet, issued an invoice, or transitioned the row.
-- The charge was proven exact (round(amount * 0.01, 2), single
-- writer, UNIQUE(collection_id)) but never actually collected.
--
-- Now:
--   * momo_platform_charges can be 'recorded' (outstanding) or
--     'collected', with collected_at + collected_transaction_id
--     (the merchant-side debit transaction's uuid_id) stamped when
--     the money moves.
--   * public._momo_collect_wallet_charges(user, wallet) — private
--     helper: collects that wallet's outstanding charges
--     OLDEST FIRST, WHOLE CHARGES ONLY (a charge is never partly
--     paid), stopping at the first charge the balance cannot cover
--     in full. The collected total moves in ONE movement: a debit
--     on the merchant's wallet (category 'momo_service_charge')
--     and a 'platform_fee' credit to the platform owner's Main
--     ZMW wallet — the same destination and row shape the
--     transfer/send fee legs use. PayPal provenance follows the
--     money spent-first (paypal_taint_move), as every other
--     wallet debit on this platform.
--   * public.collect_momo_charges(user) — service-role-only RPC
--     that runs the helper for every wallet holding the user's
--     outstanding charges and returns the total collected. Safe
--     to call any number of times: with nothing outstanding (or
--     nothing affordable) it collects 0.
--   * settle_momo_collection calls the helper for the settled
--     wallet at the end of a successful settle — the settlement
--     credit stays IN FULL (unchanged); the charge is collected
--     afterwards as its own ledger movement. Collection can
--     NEVER fail a settlement: on any error the charges simply
--     stay 'recorded' for the sweep.
--   * An hourly pg_cron sweep calls the RPC for every user with
--     outstanding charges, collecting charges that could not be
--     collected at settle time (e.g. an empty wallet) once the
--     wallet is funded by any means.
--
-- Double-collection is impossible: the helper locks the wallet
-- row first, then the charge rows FOR UPDATE in oldest-first
-- order, and only transitions rows still 'recorded' inside the
-- same transaction — a concurrent collector re-reads the
-- committed state before it can move anything.
--
-- When the merchant IS the platform owner (his own business),
-- debit and credit run uniformly — against the same wallet they
-- net to zero, and the charges are still marked collected with
-- real transaction rows on both sides.

-- ── 1. Schema: charges can transition recorded → collected ─────
ALTER TABLE public.momo_platform_charges
  DROP CONSTRAINT momo_platform_charges_status_check;

ALTER TABLE public.momo_platform_charges
  ADD CONSTRAINT momo_platform_charges_status_check
  CHECK (status IN ('recorded', 'collected'));

ALTER TABLE public.momo_platform_charges
  ADD COLUMN IF NOT EXISTS collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS collected_transaction_id uuid;

COMMENT ON COLUMN public.momo_platform_charges.collected_transaction_id IS
  'uuid_id of the merchant-side debit transaction that collected this charge (category momo_service_charge). NULL while outstanding.';

CREATE INDEX IF NOT EXISTS momo_platform_charges_outstanding_idx
  ON public.momo_platform_charges (user_id, created_at)
  WHERE status = 'recorded';

-- ── 2. Private per-wallet collection helper ────────────────────
CREATE OR REPLACE FUNCTION public._momo_collect_wallet_charges(p_user_id uuid, p_wallet_id uuid)
 RETURNS TABLE(collected_amount numeric, charge_ids uuid[], debit_transaction_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_balance NUMERIC;
  v_platform_user UUID;
  v_platform_wallet_id UUID;
  v_platform_wallet_status TEXT;
  v_total NUMERIC := 0;
  v_ids UUID[] := '{}';
  v_charge RECORD;
  v_movement UUID := gen_random_uuid();
  v_merchant_name TEXT;
  v_description TEXT;
BEGIN
  collected_amount := 0;
  charge_ids := '{}';
  debit_transaction_id := NULL;

  IF p_user_id IS NULL OR p_wallet_id IS NULL THEN
    RETURN NEXT; RETURN;
  END IF;

  -- Lock the wallet FIRST: every collector of this wallet (settle
  -- hook, hourly sweep, manual run) serialises here, and the
  -- balance read below is the committed balance under our lock —
  -- a wallet can never be debited below zero by two collectors.
  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = p_wallet_id AND w.user_id = p_user_id
  FOR UPDATE;

  IF v_wallet.id IS NULL OR v_wallet.currency <> 'ZMW'
     OR v_wallet.status = 'closed' THEN
    RETURN NEXT; RETURN;
  END IF;

  v_balance := v_wallet.balance;
  IF v_balance <= 0 THEN
    RETURN NEXT; RETURN;
  END IF;

  -- Platform destination: the earliest admin's Main ZMW wallet —
  -- the same rule (and on-demand creation) as the transfer fee
  -- legs. A closed platform wallet cannot receive; the charges
  -- then simply stay recorded for a later attempt.
  v_platform_user := public.treasury_platform_user_id();
  IF v_platform_user IS NULL THEN
    RETURN NEXT; RETURN;
  END IF;

  SELECT w.id, w.status INTO v_platform_wallet_id, v_platform_wallet_status
  FROM public.wallets w
  WHERE w.user_id = v_platform_user AND w.currency = 'ZMW'
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_platform_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (v_platform_user, 'ZMW', 0, 'active')
    RETURNING id INTO v_platform_wallet_id;
    v_platform_wallet_status := 'active';
  END IF;

  IF v_platform_wallet_status = 'closed' THEN
    RETURN NEXT; RETURN;
  END IF;

  -- Oldest first, whole charges only, FIFO stop: walk the
  -- outstanding charges for THIS wallet in age order, locking
  -- each row, and stop at the first charge the remaining balance
  -- cannot cover in full. (Under READ COMMITTED a row a racing
  -- collector already transitioned fails the status predicate
  -- when its lock clears and is skipped.)
  FOR v_charge IN
    SELECT c.id, c.amount
    FROM public.momo_platform_charges c
    JOIN public.momo_collections col ON col.id = c.collection_id
    WHERE c.user_id = p_user_id
      AND c.status = 'recorded'
      AND col.wallet_id = p_wallet_id
    ORDER BY c.created_at, c.id
    FOR UPDATE OF c
  LOOP
    EXIT WHEN v_total + v_charge.amount > v_balance;
    v_total := v_total + v_charge.amount;
    v_ids := v_ids || v_charge.id;
  END LOOP;

  IF v_total <= 0 THEN
    RETURN NEXT; RETURN;
  END IF;

  -- ONE movement for the collected total: merchant wallet →
  -- platform wallet. When both are the same wallet (the platform
  -- owner is the merchant) the two updates net to zero, exactly
  -- as a self-fee should.
  UPDATE public.wallets
  SET balance = balance - v_total, updated_at = now()
  WHERE id = p_wallet_id;

  UPDATE public.wallets
  SET balance = balance + v_total, updated_at = now()
  WHERE id = v_platform_wallet_id;

  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_merchant_name
  FROM public.profiles p
  WHERE p.id = p_user_id;

  v_description := 'Mobile money service charges collected ('
    || array_length(v_ids, 1) || ' × 1%)';

  INSERT INTO public.transactions
    (uuid_id, user_id, wallet_id, amount, currency, direction,
     payment_method, status, recipient_name, description, reference,
     category, idempotency_key, metadata)
  VALUES
    (v_movement, p_user_id, p_wallet_id, v_total, 'ZMW', 'outgoing',
     'mobile_money', 'completed', 'BMaGlass Pay', v_description,
     'momo-service-charges:' || v_movement::text,
     'momo_service_charge',
     'momo-charge-collect:' || v_movement::text,
     jsonb_build_object(
       'charge_ids', to_jsonb(v_ids),
       'charge_count', array_length(v_ids, 1)))
  RETURNING uuid_id INTO debit_transaction_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction,
     payment_method, status, recipient_name, description, reference,
     category, idempotency_key, metadata)
  VALUES
    (v_platform_user, v_platform_wallet_id, v_total, 'ZMW', 'incoming',
     'mobile_money', 'completed', v_merchant_name, v_description,
     'momo-service-charges:' || v_movement::text,
     'platform_fee',
     'momo-charge-collect:' || v_movement::text || ':in',
     jsonb_build_object(
       'charge_ids', to_jsonb(v_ids),
       'charge_count', array_length(v_ids, 1)));

  UPDATE public.momo_platform_charges
  SET status = 'collected',
      collected_at = now(),
      collected_transaction_id = debit_transaction_id
  WHERE id = ANY (v_ids);

  -- Provenance follows the money: the merchant's PayPal-sourced
  -- mark moves spent-first with the collected total, exactly as
  -- it does for every other wallet debit on this platform.
  PERFORM public.paypal_taint_move(p_user_id, v_platform_user, 'ZMW', v_total);

  collected_amount := v_total;
  charge_ids := v_ids;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public._momo_collect_wallet_charges(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. Public sweep RPC (service role only) ────────────────────
CREATE OR REPLACE FUNCTION public.collect_momo_charges(p_user_id uuid)
 RETURNS TABLE(collected_amount numeric, charge_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_wallet_id UUID;
  v_part_amount NUMERIC;
  v_part_ids UUID[];
  v_total NUMERIC := 0;
  v_ids UUID[] := '{}';
BEGIN
  IF p_user_id IS NOT NULL THEN
    FOR v_wallet_id IN
      SELECT DISTINCT col.wallet_id
      FROM public.momo_platform_charges c
      JOIN public.momo_collections col ON col.id = c.collection_id
      WHERE c.user_id = p_user_id AND c.status = 'recorded'
      ORDER BY 1
    LOOP
      SELECT h.collected_amount, h.charge_ids
      INTO v_part_amount, v_part_ids
      FROM public._momo_collect_wallet_charges(p_user_id, v_wallet_id) h;

      IF v_part_amount IS NOT NULL AND v_part_amount > 0 THEN
        v_total := v_total + v_part_amount;
        v_ids := v_ids || v_part_ids;
      END IF;
    END LOOP;
  END IF;

  collected_amount := v_total;
  charge_ids := v_ids;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.collect_momo_charges(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_momo_charges(uuid) TO service_role;

-- ── 4. settle_momo_collection: collect at the end of a settle ──
-- CREATE OR REPLACE from the LIVE definition (20261259, verified
-- against pg_proc 2026-11-12): full credit, separate 1% charge,
-- terminal guards and amount/currency matching are unchanged.
-- The only additions are the collection hook and the balance
-- refresh in the successful branch.
CREATE OR REPLACE FUNCTION public.settle_momo_collection(p_reference text, p_provider_status text, p_provider_reference text DEFAULT NULL::text, p_provider_amount numeric DEFAULT NULL::numeric, p_provider_currency text DEFAULT NULL::text, p_provider_fee numeric DEFAULT NULL::numeric, p_provider_status_raw text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, collection_status text, transaction_status text, wallet_balance numeric, collection_id uuid, transaction_id uuid, payment_link_id uuid, merchant_user_id uuid, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    RETURN NEXT; RETURN;
  END IF;

  collection_id := v_collection.id;
  transaction_id := v_collection.transaction_id;
  payment_link_id := v_collection.payment_link_id;
  merchant_user_id := v_collection.user_id;
  amount := v_collection.amount;

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

  -- A terminal settlement must match the ledger exactly.
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

    -- The platform's 1 percent, billed separately to the merchant.
    v_charge := round(v_collection.amount * 0.01, 2);
    INSERT INTO public.momo_platform_charges (user_id, collection_id, amount, currency, percent)
    VALUES (v_collection.user_id, v_collection.id, v_charge, v_collection.currency, 1)
    ON CONFLICT (collection_id) DO NOTHING;

    -- Payment-link counters move exactly once, inside the same
    -- transaction as the credit (the terminal guard above is what
    -- makes this once-only).
    IF v_collection.payment_link_id IS NOT NULL THEN
      UPDATE public.payment_links
      SET payment_count = COALESCE(payment_count, 0) + 1,
          total_collected = COALESCE(total_collected, 0) + v_collection.amount,
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
$function$;

REVOKE ALL ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- ── 5. Hourly sweep for charges that missed settle-time ────────
-- Charges that could not be collected when they landed (empty
-- wallet, platform wallet unavailable) are retried here once the
-- wallet holds funds again. The RPC no-ops per user when nothing
-- is outstanding or affordable, so the sweep is cheap and safe
-- to run with the rail dark.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'momo-charge-collection') THEN
    PERFORM cron.unschedule('momo-charge-collection');
  END IF;
END $$;

SELECT cron.schedule(
  'momo-charge-collection',
  '7 * * * *',
  $$
  SELECT public.collect_momo_charges(u.user_id)
  FROM (
    SELECT DISTINCT c.user_id
    FROM public.momo_platform_charges c
    WHERE c.status = 'recorded'
  ) u;
  $$);
