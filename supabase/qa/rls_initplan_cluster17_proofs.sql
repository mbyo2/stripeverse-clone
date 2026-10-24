-- PR20 — behaviour proofs for 20261129 (cluster 17), run in the dashboard SQL editor.
-- HOW TO RUN: one DO block per Run (the editor does not preserve SET ROLE across Runs, and it does
-- not display NOTICE text — so each block signals failure ONLY by RAISE; no exception = pass).
-- qa9  = fe5e5d30-ead1-49a1-a19c-1c954cc16dfc (plain user, no admin role)
-- qa13 = 171ac06a-6536-45fb-bd7a-526a6515ad01 (user + admin)
-- PR20a (plain user): no foreign rows visible anywhere, no rate_limits, no inactive pricing tiers,
-- and every visible plan_installment_payments row links to a qa9-visible plan owned by qa9.
-- PR20b (admin): qa13 sees ALL pricing_tiers, rate_limits and provider_intents rows (totals are
-- captured as the dashboard role before the role switch inside the same block).

-- PR20a — plain user blindness
DO $$
DECLARE
  v_bad int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"fe5e5d30-ead1-49a1-a19c-1c954cc16dfc","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_bad FROM public.paypal_withdrawals WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: paypal_withdrawals foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.pos_payment_requests WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: pos_payment_requests foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.saved_contacts WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: saved_contacts foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.settlement_reports WHERE merchant_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: settlement_reports foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.provider_intents WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: provider_intents foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.rate_limits;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: rate_limits visible to plain user: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.pricing_tiers WHERE is_active = false;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: inactive pricing tiers visible to plain user: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.plan_installment_payments pip WHERE NOT EXISTS (SELECT 1 FROM public.merchant_payment_plans p WHERE p.id = pip.plan_id AND p.merchant_id = 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR20a FAIL: plan_installment_payments rows not linked to qa9 plans: %', v_bad; END IF;
END $$;

-- PR20b — admin visibility (totals captured before the role switch, same block)
DO $$
DECLARE
  v_total_tiers int; v_vis_tiers int;
  v_total_limits int; v_vis_limits int;
  v_total_intents int; v_vis_intents int;
BEGIN
  SELECT count(*) INTO v_total_tiers FROM public.pricing_tiers;
  SELECT count(*) INTO v_total_limits FROM public.rate_limits;
  SELECT count(*) INTO v_total_intents FROM public.provider_intents;
  PERFORM set_config('request.jwt.claims', '{"sub":"171ac06a-6536-45fb-bd7a-526a6515ad01","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_vis_tiers FROM public.pricing_tiers;
  IF v_vis_tiers <> v_total_tiers THEN RAISE EXCEPTION 'PR20b FAIL: admin pricing_tiers visible % of total %', v_vis_tiers, v_total_tiers; END IF;
  SELECT count(*) INTO v_vis_limits FROM public.rate_limits;
  IF v_vis_limits <> v_total_limits THEN RAISE EXCEPTION 'PR20b FAIL: admin rate_limits visible % of total %', v_vis_limits, v_total_limits; END IF;
  SELECT count(*) INTO v_vis_intents FROM public.provider_intents;
  IF v_vis_intents <> v_total_intents THEN RAISE EXCEPTION 'PR20b FAIL: admin provider_intents visible % of total %', v_vis_intents, v_total_intents; END IF;
END $$;
