-- Fix silently-failing client writes + view privilege exposure — 2026-11-09.
--
-- Follow-up to the 20261255/20261256 grant sweeps. The sweeps aligned the
-- GRANT layer with each table's RLS policies; this migration fixes the
-- places where the POLICY layer (or a view's grants) never matched the
-- product behaviour, so legitimate UI actions failed with 42501 and the
-- failure was swallowed in the UI. All findings below were proven live
-- with QA accounts before this migration was written.
--
-- (a) public.notifications — real user features with no path to succeed:
--     * NotificationContext.createNotification and the KYC flow insert a
--       notification for the acting user (user_id = auth.uid()).
--     * The Notifications page "Clear all" deletes the user's own rows.
--     The table had only SELECT/UPDATE policies and authenticated held
--     only SELECT/UPDATE grants, so both actions were denied (42501).
--     Fix: owner-scoped INSERT and DELETE policies + the matching grants.
--     Cross-user writes stay impossible: the policies pin user_id to
--     auth.uid() on both the USING and WITH CHECK side.
--
-- (b) public.beta_feedback — the admin FeedbackDashboard delete action:
--     SELECT is admin-gated via has_role('admin'), but there was no
--     DELETE policy and no DELETE grant for authenticated, so an admin's
--     delete was denied (42501). Fix: DELETE grant + an admin-scoped
--     DELETE policy using the platform's has_role pattern (admin or
--     super_admin, matching the transactions admin policies).
--
-- (c) public.webhook_delivery_logs — merchant "Queue Retry" action
--     (WebhookLogs page): the client updated status/next_retry_at
--     directly, but there is no UPDATE policy/grant for the business
--     owner, so the retry never queued (42501) while the processor
--     function (service_role) waited for 'pending' rows that never came.
--     A blanket owner UPDATE policy would also let a merchant rewrite
--     their own delivery history (payload, status, attempts), so the
--     fix is a narrow SECURITY DEFINER RPC, request_webhook_retry, that
--     verifies business ownership and only performs the one legitimate
--     transition: failed + attempts remaining -> pending, due now.
--     The client hook is rewired to the RPC in the same change.
--
-- (d) public.transactions — NO policy change, by design: the explicit
--     "Block client-side transaction inserts" policy stands. Money rows
--     are created only by server functions/RPCs. The one client call
--     site (useInitiateBankTransfer in src/hooks/useBankTransfers.ts)
--     was dead code with zero callers; it is removed in the client, not
--     enabled here.
--
-- (e) Views (never covered by the table sweeps):
--     * public.p2p_trader_public (owner-rights view over
--       p2p_trader_profiles) carried the full blanket grant set for
--       `authenticated`. Because it is a simple auto-updatable view
--       running with owner rights, ANY signed-in user could UPDATE or
--       DELETE ANY trader's public stats through the view, bypassing
--       the base table's own-row RLS — proven live (a second QA user
--       rewrote and deleted the first QA user's trader row; restored).
--       Its columns are genuinely public reputation fields (nickname +
--       trade statistics; no contact or identity data), so the fix
--       keeps read access and strips every write privilege. `anon`
--       held no grant at all (the public read was grant-blocked); anon
--       SELECT is granted to match the view's public purpose.
--     * public.merchant_accounts_safe already runs with
--       security_invoker=on and exposes only api_key_masked /
--       webhook_secret_masked (verified: no raw api_key or
--       webhook_secret columns), and cross-user reads/writes through it
--       are scoped by the base table's RLS (proven live). What remained
--       was the same blanket write-grant set for anon + authenticated
--       on the view itself; those are stripped and anon SELECT is
--       revoked (its only consumer, useBusinessData, is authenticated
--       and reads the caller's own row). security_invoker is re-asserted
--       defensively.
--
-- service_role is untouched everywhere. All grants on these objects were
-- granted by `postgres`, so the revokes are effective (verified live
-- after applying by re-reading the privilege catalogues, pg_policies
-- and proacl).

-- ---------------------------------------------------------------------------
-- (a) notifications: owner INSERT + DELETE
-- ---------------------------------------------------------------------------
GRANT INSERT, DELETE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS "Users can create their own notifications" ON public.notifications;
CREATE POLICY "Users can create their own notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (( SELECT auth.uid() AS uid) = user_id);

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications
  FOR DELETE
  USING (( SELECT auth.uid() AS uid) = user_id);

-- ---------------------------------------------------------------------------
-- (b) beta_feedback: admins can delete
-- ---------------------------------------------------------------------------
GRANT DELETE ON TABLE public.beta_feedback TO authenticated;

DROP POLICY IF EXISTS "Admins can delete beta feedback" ON public.beta_feedback;
CREATE POLICY "Admins can delete beta feedback"
  ON public.beta_feedback
  FOR DELETE
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)
      OR has_role(( SELECT auth.uid() AS uid), 'super_admin'::app_role));

-- ---------------------------------------------------------------------------
-- (c) webhook retry: narrow SECURITY DEFINER RPC instead of a table UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_webhook_retry(p_log_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_business_id uuid;
  v_status text;
  v_attempts integer;
  v_max_attempts integer;
BEGIN
  SELECT business_id, status, attempts, max_attempts
    INTO v_business_id, v_status, v_attempts, v_max_attempts
    FROM public.webhook_delivery_logs
   WHERE id = p_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That webhook delivery could not be found.';
  END IF;

  -- Ownership: the log's business must belong to the caller. The same
  -- message as not-found, so log ids cannot be probed across businesses.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_accounts ma
     WHERE ma.id = v_business_id
       AND ma.user_id = ( SELECT auth.uid() )
  ) THEN
    RAISE EXCEPTION 'That webhook delivery could not be found.';
  END IF;

  IF v_status <> 'failed' OR v_attempts >= v_max_attempts THEN
    RAISE EXCEPTION 'This delivery cannot be retried right now.';
  END IF;

  UPDATE public.webhook_delivery_logs
     SET status = 'pending',
         next_retry_at = now(),
         updated_at = now()
   WHERE id = p_log_id;

  RETURN true;
END;
$function$;

-- A fresh CREATE inherits EXECUTE for PUBLIC/anon/authenticated on
-- Supabase; strip it back to the intended callers and verify via proacl.
REVOKE EXECUTE ON FUNCTION public.request_webhook_retry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_webhook_retry(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (e) views: strip write privileges; align read grants with purpose
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.merchant_accounts_safe FROM anon, authenticated;
REVOKE SELECT ON TABLE public.merchant_accounts_safe FROM anon;
ALTER VIEW public.merchant_accounts_safe SET (security_invoker = true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.p2p_trader_public FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_trader_public TO anon;
