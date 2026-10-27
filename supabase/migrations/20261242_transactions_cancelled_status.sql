-- ---------------------------------------------------------------------
-- 20261242 — transactions: allow the 'cancelled' status.
--
-- A PayPal wallet deposit the payer abandons at PayPal (cancel-URL
-- return) used to sit at 'pending' forever, and Recent Activity
-- showed it as "awaiting confirmation" indefinitely. The
-- paypal-deposit-capture cancel action now flips such a row to
-- 'cancelled' — but ONLY after verifying against PayPal's own order
-- state that the order was never approved and carries no completed
-- capture (see planCancellation in _shared/deposit-capture.ts).
--
-- Money safety: this widens the status vocabulary; it changes no
-- completion path. complete_wallet_deposit locks the row FOR UPDATE
-- and answers 'not_pending' for any status other than 'pending', so
-- a cancelled row can never be credited afterwards — the existing
-- confirmation path governs any capture that somehow completes
-- later (support reconciles from the order reference). A completed
-- row is never touched by the cancel path.
--
-- Live-verified before applying: the constraint is
-- transactions_status_check = status IN ('pending','completed',
-- 'failed'); live rows use only 'pending' and 'completed'.
-- ---------------------------------------------------------------------

ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_status_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'cancelled'));
