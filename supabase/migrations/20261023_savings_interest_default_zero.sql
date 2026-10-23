-- =====================================================================
-- 20261023_savings_interest_default_zero.sql — dormant APY cleanup.
--
-- savings_accounts.interest_rate defaulted to 3.5 (Lovable-era schema),
-- but NOTHING in the platform accrues or pays interest — no function,
-- RPC, trigger or cron writes interest_earned (see the note in
-- src/pages/Savings.tsx: no interest is shown or promised, per the
-- CEO's decision that savings stay interest-free until an accrual
-- engine is funded and built). The 3.5 default made every new pot
-- carry a misleading rate in the data. Default is now 0 and existing
-- rows are normalised to 0 (interest_earned is 0 everywhere; the
-- Phase 3 exploitation scan reconciled savings independently).
-- Applied live 2026-10-23 (hardening batch); verified column_default=0.
-- =====================================================================

ALTER TABLE public.savings_accounts
  ALTER COLUMN interest_rate SET DEFAULT 0;
UPDATE public.savings_accounts SET interest_rate = 0
  WHERE interest_rate <> 0;
