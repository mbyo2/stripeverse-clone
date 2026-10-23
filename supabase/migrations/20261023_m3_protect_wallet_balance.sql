-- =====================================================================
-- 20261023_m3_protect_wallet_balance.sql — M3 (audit P2-17).
--
-- protect_wallet_balance() is a money-critical invariant: it silently
-- reverts any wallets.balance change attempted under a user JWT, so
-- balances can only move through service-role paths (edge functions /
-- RPCs). Until now it existed ONLY in the live database — no migration
-- defined it, so any rebuild, restore or new environment from the
-- migration history would silently lose it while the code that
-- depends on its exact behaviour kept running.
--
-- The definition below is the LIVE body, captured verbatim from
-- pg_get_functiondef on 2026-10-23 (Phase 3 introspection S-38 +
-- hardening-batch fetch), and the trigger is the live one:
-- protect_wallets_bal, BEFORE UPDATE on public.wallets. Applying this
-- migration against the current live database is a no-op restatement;
-- its purpose is that the invariant now exists in the repo of record.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.protect_wallet_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.balance := OLD.balance;
  END IF;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS protect_wallets_bal ON public.wallets;
CREATE TRIGGER protect_wallets_bal
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_wallet_balance();
