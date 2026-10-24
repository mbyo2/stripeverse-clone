-- PR21 — behaviour proofs for 20261130 (cluster 18, FINAL), run in the dashboard SQL editor.
-- HOW TO RUN: one DO block per Run (the editor does not preserve SET ROLE across Runs, and it does
-- not display NOTICE text — so each block signals failure ONLY by RAISE; no exception = pass).
-- qa9  = fe5e5d30-ead1-49a1-a19c-1c954cc16dfc (plain user, no admin role)
-- qa13 = 171ac06a-6536-45fb-bd7a-526a6515ad01 (user + admin)
-- PR21a (plain user): no foreign rows visible on any own-keyed table, and no inactive
-- transaction_categories visible.
-- PR21b (admin): qa13 sees ALL transaction_categories rows (totals captured as the dashboard role
-- before the role switch inside the same block).
-- GLOBAL recheck (separate query, not a DO block): must return 0 rows — that closes Fix #2.

-- PR21a — plain user blindness
DO $$
DECLARE
  v_bad int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"fe5e5d30-ead1-49a1-a19c-1c954cc16dfc","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_bad FROM public.spending_budgets WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: spending_budgets foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.split_rules WHERE owner_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: split_rules foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.subaccounts WHERE owner_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: subaccounts foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.subscription_invoices WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: subscription_invoices foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.subscription_usage WHERE user_id <> 'fe5e5d30-ead1-49a1-a19c-1c954cc16dfc';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: subscription_usage foreign rows visible: %', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.transaction_categories WHERE is_active = false;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PR21a FAIL: inactive transaction_categories visible to plain user: %', v_bad; END IF;
END $$;

-- PR21b — admin visibility on transaction_categories
DO $$
DECLARE
  v_total_cats int; v_vis_cats int;
BEGIN
  SELECT count(*) INTO v_total_cats FROM public.transaction_categories;
  PERFORM set_config('request.jwt.claims', '{"sub":"171ac06a-6536-45fb-bd7a-526a6515ad01","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_vis_cats FROM public.transaction_categories;
  IF v_vis_cats <> v_total_cats THEN RAISE EXCEPTION 'PR21b FAIL: admin transaction_categories visible % of total %', v_vis_cats, v_total_cats; END IF;
END $$;
