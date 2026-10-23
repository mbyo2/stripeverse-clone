-- =====================================================================
-- 20261023_p0_policy_remediation.sql — P0/P1 policy + grant remediation.
--
-- Repo record of the changes applied LIVE to project paymentgetway on
-- 2026-10-23 via the dashboard SQL editor (Phase 3 of the full-platform
-- security audit remediation; see the sweep's
-- hidden_files/security-remediation-2026-10-23/05-phase3-live-fixes.md).
-- Every statement below succeeded live and was verified in place.
-- The companion RPC change lives in 20261023_p0_remediation.sql.
--
-- Contents: savings policy surgery (P0-3), virtual-cards policy surgery
-- (P0-4), escrow transition policies (P0-11), refunds self-approval
-- closure (P1-10), KYC self-update closure (P1-19), wallets client
-- UPDATE removal, transactions table-grant revokes, money-RPC EXECUTE
-- revokes (P2-13), owner-email admin trigger removal (P0-conditional
-- Part 2). NOT included (verified already-safe live): P0-1 mint grant,
-- P0-5 tables (absent live), P0-6 subscribers, handle_new_user.
-- =====================================================================

-- ── P0-3 savings_accounts ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage their savings" ON public.savings_accounts;
CREATE POLICY "Users can view their savings" ON public.savings_accounts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create savings goals" ON public.savings_accounts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND balance = 0 AND interest_earned = 0);
CREATE POLICY "Users can update savings goal settings" ON public.savings_accounts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE UPDATE, DELETE ON public.savings_accounts FROM authenticated;
GRANT UPDATE (name, target_amount, target_date, auto_save_amount,
  auto_save_frequency, updated_at) ON public.savings_accounts TO authenticated;

-- ── P0-4 virtual_cards ───────────────────────────────────────────────
-- ("System can manage cards" is admin-gated via has_role — kept.
--  The two SELECT-own policies are kept.)
DROP POLICY IF EXISTS "Users manage own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can insert their own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can update their own cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can update their own virtual cards" ON public.virtual_cards;
CREATE POLICY "Users can update own card settings" ON public.virtual_cards
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status IN ('active','frozen','cancelled'));
REVOKE INSERT, UPDATE, DELETE ON public.virtual_cards FROM authenticated;
GRANT UPDATE (status, daily_limit, monthly_limit, transaction_limit,
  online_transactions, international_transactions, updated_at)
  ON public.virtual_cards TO authenticated;

-- ── P0-11 escrow_transactions policies (RPC in the companion file) ───
DROP POLICY IF EXISTS "Buyers can create escrow" ON public.escrow_transactions;
CREATE POLICY "Buyers can create escrow" ON public.escrow_transactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = buyer_id AND seller_id <> buyer_id
    AND status = 'pending' AND funded_at IS NULL AND released_at IS NULL
    AND disputed_at IS NULL AND cancelled_at IS NULL
    AND hold_transaction_id IS NULL AND settlement_transaction_id IS NULL);
DROP POLICY IF EXISTS "Participants can update escrow" ON public.escrow_transactions;
CREATE POLICY "Participants can flag escrow transitions" ON public.escrow_transactions
  FOR UPDATE TO authenticated
  USING ((auth.uid() = buyer_id OR auth.uid() = seller_id)
    AND status IN ('pending', 'funded'))
  WITH CHECK ((auth.uid() = buyer_id OR auth.uid() = seller_id)
    AND status IN ('funded', 'disputed'));
REVOKE UPDATE ON public.escrow_transactions FROM authenticated;
GRANT UPDATE (status, funded_at, hold_transaction_id, disputed_at, updated_at)
  ON public.escrow_transactions TO authenticated;
CREATE POLICY "Buyers can delete unfunded escrow" ON public.escrow_transactions
  FOR DELETE TO authenticated
  USING (auth.uid() = buyer_id AND status = 'pending');

-- ── P1-10 refunds self-approval ──────────────────────────────────────
-- ("Admins manage all refunds" already covers admins.)
DROP POLICY IF EXISTS "Recipients can approve refunds" ON public.refunds;
CREATE POLICY "Approvers can settle refunds" ON public.refunds
  FOR UPDATE TO authenticated
  USING (status = 'pending' AND auth.uid() <> user_id)
  WITH CHECK (approved_by = auth.uid() AND auth.uid() <> user_id);
REVOKE UPDATE ON public.refunds FROM authenticated;
GRANT UPDATE (status, approved_by, approved_at, rejected_at,
  settlement_transaction_id) ON public.refunds TO authenticated;

-- ── P1-19 KYC self-update ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update their own KYC" ON public.kyc_verifications;

-- ── wallets client UPDATE removal (protect_wallet_balance trigger
--    remains as backstop; client wallet creation is INSERT, untouched)
DROP POLICY IF EXISTS "Users can update their own wallets" ON public.wallets;

-- ── transactions table grants ────────────────────────────────────────
REVOKE DELETE, UPDATE, TRIGGER, TRUNCATE, REFERENCES
  ON public.transactions FROM anon, authenticated;
REVOKE SELECT ON public.transactions FROM anon;

-- ── P2-13 money-RPC EXECUTE revokes (signature-proof; idempotent) ───
DO $$
DECLARE r record; n text;
BEGIN
  FOREACH n IN ARRAY ARRAY[
    'btc_adjust_crypto_wallet','btc_record_deposit','btc_reserve_withdrawal',
    'btc_finalize_withdrawal','btc_fail_withdrawal','btc_execute_trade',
    'btc_next_derivation_index','btc_next_change_index','next_btc_derivation_index',
    'execute_atomic_transfer','execute_internal_transfer',
    'execute_currency_conversion','execute_savings_transfer','generate_card_number'
  ] LOOP
    FOR r IN SELECT oid FROM pg_proc
             WHERE pronamespace = 'public'::regnamespace AND proname = n LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
    END LOOP;
  END LOOP;
END $$;

-- ── P0-conditional Part 2: owner-email admin grant removal ───────────
-- (The owner's existing admin row in user_roles persists; re-creation
--  of the owner account no longer self-grants admin.)
DROP TRIGGER IF EXISTS on_auth_user_owner_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_owner_admin();
