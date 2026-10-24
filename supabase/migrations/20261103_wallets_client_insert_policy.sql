-- 20261103_wallets_client_insert_policy.sql
-- BUG FIX (live defect, QA Wave A 2026-10-23): a fresh signed-in user
-- on /multi-currency creating a currency wallet (e.g. USD) got the
-- toast "You don't have permission to do that." and the wallet was
-- never created — so the Convert dialog's "To Wallet" list stayed
-- empty and no conversion quote could be obtained.
--
-- ROOT CAUSE: 20261022_wallets_insert_lockdown.sql dropped BOTH
-- client INSERT policies on public.wallets ("Users create own
-- wallets" and "Users can insert their own wallets") to close audit
-- finding C1 — the old policies checked only auth.uid() = user_id
-- and placed no constraint on balance, so any signed-in user could
-- insert a wallet carrying an arbitrary balance (money creation,
-- proven live at the time). The lockdown's premise was that "no
-- client flow inserts into wallets directly" — that premise was
-- wrong: src/hooks/useMultiCurrency.ts (useCreateWallet, used by
-- src/pages/MultiCurrencyWallet.tsx) creates currency wallets with a
-- direct client INSERT { user_id, currency, balance: 0, status:
-- 'active', account_id }. With no INSERT policy left, RLS denies
-- every such insert (42501), which the client maps to the permission
-- toast. The 20261023 P0 remediation already assumed this flow
-- exists ("client wallet creation is INSERT, untouched").
--
-- FIX: restore a client INSERT policy, but constrained so the C1
-- money-creation hole stays closed. An authenticated user may insert
-- a wallet row ONLY when ALL of the following hold:
--   * user_id is their own auth.uid();
--   * balance is exactly 0 (no balance manipulation at creation —
--     balances still move only through service-role paths, and the
--     protect_wallet_balance BEFORE UPDATE trigger still reverts
--     any balance change attempted under a user JWT);
--   * status is 'active' (the only status the create flow uses);
--   * currency is one of the supported currencies offered by the
--     multi-currency UI (ZMW USD EUR GBP ZAR NGN KES TZS BWP);
--   * account_id is NULL (Main account) or names an account the
--     user owns that is not closed (no attaching wallets to another
--     user's sub-account).
-- The per-account unique indexes (wallets_main_currency_uq /
-- wallets_sub_currency_uq) still prevent duplicate currency wallets.
--
-- GRANT hygiene: table-level INSERT is granted to authenticated
-- only (the policy above is the gate); anon receives nothing.
-- service_role is unaffected (bypasses RLS as before), so signup
-- triggers and service-role RPCs keep creating wallets exactly as
-- they do today.

REVOKE INSERT ON public.wallets FROM anon;
GRANT INSERT ON public.wallets TO authenticated;

DROP POLICY IF EXISTS "Users create own wallets" ON public.wallets;
CREATE POLICY "Users create own wallets"
ON public.wallets FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND balance = 0
  AND status = 'active'
  AND currency IN ('ZMW', 'USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'KES', 'TZS', 'BWP')
  AND (
    account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = wallets.account_id
        AND a.user_id = auth.uid()
        AND a.status <> 'closed'
    )
  )
);
