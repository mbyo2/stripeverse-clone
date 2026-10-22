-- 20261022_wallets_insert_lockdown.sql
-- SECURITY FIX (audit finding C1, confirmed live 2026-10-22):
-- Two INSERT policies on public.wallets ("Users create own wallets" from
-- 20261017_atomic_transfer.sql and "Users can insert their own wallets"
-- from 20260308114647) checked only auth.uid() = user_id and placed NO
-- constraint on the balance column. protect_wallet_balance is a BEFORE
-- UPDATE trigger, so it never fires on INSERT. Any signed-in user could
-- insert a wallet row carrying an arbitrary balance (money creation),
-- proven live with a QA account inserting a USD wallet at 999999.00.
--
-- Wallet rows are created exclusively by trusted server paths
-- (signup triggers, service-role RPCs: sub-account creation, deposit
-- settlement, atomic transfers) — no client flow inserts into wallets
-- directly. Dropping both INSERT policies therefore changes no
-- legitimate behaviour; service_role bypasses RLS as before.
--
-- The CHECK is defence-in-depth against negative-balance rows from any
-- future path; the policy drop is the actual fix.

DROP POLICY IF EXISTS "Users create own wallets" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert their own wallets" ON public.wallets;

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_balance_nonnegative CHECK (balance >= 0);
