-- =====================================================================
-- 20261023_p2_9_ledger_column_sweep.sql — audit P2-9 (remainder).
--
-- Introspection (2026-10-23, live): nine ledger tables each carry one
-- FOR ALL policy for 'authenticated' and table-level UPDATE grants on
-- EVERY column. Seven of the policies had WITH CHECK NULL, so a
-- signed-in user could INSERT rows owned by someone else (the
-- card_tokens hole, repeated). This migration:
--
-- A. Adds the missing WITH CHECK (= the USING expression) to the
--    seven policies: bill_payments, bulk_payments,
--    bulk_payment_items, currency_conversions,
--    merchant_payment_plans, payment_links, subaccounts.
--    (merchant_invoices and plan_installment_payments already had it.)
--
-- B. Column-locks the values only the server may write:
--    - payment_links.payment_count / total_collected are maintained
--      exclusively by execute_payment_link_settlement (service_role);
--      the owner's edit form never sends them. Table UPDATE is
--      revoked and re-granted on the owner-editable columns only.
--    - subaccounts: no client code updates this table at all
--      (total_received is settlement-maintained) — UPDATE revoked.
--    - currency_conversions / bill_payments: client flows INSERT
--      only; outcomes are written by service-role flows — UPDATE
--      revoked.
--
-- NOT locked, deliberately: bulk_payments, bulk_payment_items,
-- merchant_invoices, merchant_payment_plans and
-- plan_installment_payments are client-orchestrated in the current
-- app (the browser writes batch counters, item outcomes, invoice
-- status and installment progress after invoking the server money
-- functions). Locking their outcome columns would break live flows;
-- they get the WITH CHECK fix (A) and are recorded as the residual
-- P2-9 scope, to close when orchestration moves server-side. The
-- money itself never moves on these tables — balances live on
-- wallets and move only through service-role RPCs.
--
-- Applied live 2026-10-23 (hardening batch); re-proofs in
-- 06-reproof-results.md.
-- =====================================================================

-- ── A. WITH CHECK on the seven policies ──────────────────────────────
DROP POLICY IF EXISTS "Users can manage their bill payments" ON public.bill_payments;
CREATE POLICY "Users can manage their bill payments" ON public.bill_payments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own bulk payments" ON public.bulk_payments;
CREATE POLICY "Users manage own bulk payments" ON public.bulk_payments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own bulk payment items" ON public.bulk_payment_items;
CREATE POLICY "Users manage own bulk payment items" ON public.bulk_payment_items
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.bulk_payments bp
                 WHERE bp.id = bulk_payment_items.bulk_payment_id
                   AND bp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bulk_payments bp
                 WHERE bp.id = bulk_payment_items.bulk_payment_id
                   AND bp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users view own conversions" ON public.currency_conversions;
CREATE POLICY "Users view own conversions" ON public.currency_conversions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their payment plans" ON public.merchant_payment_plans;
CREATE POLICY "Users can manage their payment plans" ON public.merchant_payment_plans
  FOR ALL USING (auth.uid() = merchant_id) WITH CHECK (auth.uid() = merchant_id);

DROP POLICY IF EXISTS "Users manage own payment links" ON public.payment_links;
CREATE POLICY "Users manage own payment links" ON public.payment_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own subaccounts" ON public.subaccounts;
CREATE POLICY "Users manage own subaccounts" ON public.subaccounts
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ── B. Server-only columns / tables ──────────────────────────────────
REVOKE UPDATE ON public.payment_links FROM authenticated;
GRANT UPDATE (account_id, amount, currency, description, expires_at,
              link_code, max_payments, metadata, redirect_url, status,
              title, updated_at)
  ON public.payment_links TO authenticated;

REVOKE UPDATE ON public.subaccounts FROM authenticated;
REVOKE UPDATE ON public.currency_conversions FROM authenticated;
REVOKE UPDATE ON public.bill_payments FROM authenticated;
