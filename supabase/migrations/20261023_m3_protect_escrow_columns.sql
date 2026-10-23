-- =====================================================================
-- 20261023_m3_protect_escrow_columns.sql — M3-class repo gap (found
-- during the 2026-10-23 hardening batch, escrow funded_at diagnostic).
--
-- protect_escrow_columns() pins the identity/money columns of
-- escrow_transactions (buyer_id, seller_id, amount, currency,
-- release_conditions, funded_at, released_at) to their OLD values for
-- any authenticated (JWT) caller, so a client can never rewrite who
-- an escrow is between or what it is worth — the B3 transition policy
-- plus this trigger are the escrow column defence. Like
-- protect_wallet_balance, it existed ONLY in the live database.
-- Definition captured verbatim from pg_get_functiondef on 2026-10-23;
-- trigger protect_escrow_columns_trg (BEFORE UPDATE) per
-- information_schema.triggers. Applying live is a no-op restatement.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.protect_escrow_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Any authenticated (non-service_role) update cannot change identity or money fields.
  IF auth.uid() IS NOT NULL THEN
    NEW.buyer_id := OLD.buyer_id;
    NEW.seller_id := OLD.seller_id;
    NEW.amount := OLD.amount;
    NEW.currency := OLD.currency;
    NEW.release_conditions := OLD.release_conditions;
    NEW.funded_at := OLD.funded_at;
    NEW.released_at := OLD.released_at;
  END IF;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS protect_escrow_columns_trg ON public.escrow_transactions;
CREATE TRIGGER protect_escrow_columns_trg
  BEFORE UPDATE ON public.escrow_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_escrow_columns();
