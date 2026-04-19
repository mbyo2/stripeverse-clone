
-- 1) Function search_path
ALTER FUNCTION public.mask_api_key(text) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- 2) Tighten "always true" INSERT/ALL policies on public role

-- audit_logs: service role only
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- role_audit: service role only
DROP POLICY IF EXISTS "System can insert role audits" ON public.role_audit;
CREATE POLICY "Service role can insert role audits"
  ON public.role_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

-- security_events: service role only
DROP POLICY IF EXISTS "System can insert security events" ON public.security_events;
CREATE POLICY "Service role can insert security events"
  ON public.security_events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- subscribers: service role only for system inserts
DROP POLICY IF EXISTS "System can create new subscriptions" ON public.subscribers;
CREATE POLICY "Service role can create subscriptions"
  ON public.subscribers FOR INSERT
  TO service_role
  WITH CHECK (true);

-- scheduled_payments: service role only
DROP POLICY IF EXISTS "Service can manage all scheduled payments" ON public.scheduled_payments;
CREATE POLICY "Service role can manage scheduled payments"
  ON public.scheduled_payments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public-facing forms: keep open insert but scoped to anon + authenticated (not service_role-only),
-- replacing the {public} grant with explicit roles to satisfy linter.
DROP POLICY IF EXISTS "Anyone can insert feedback" ON public.beta_feedback;
CREATE POLICY "Anyone can submit feedback"
  ON public.beta_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert contact messages" ON public.contact_messages;
CREATE POLICY "Anyone can submit contact messages"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert newsletter subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Anyone can subscribe to newsletter"
  ON public.newsletter_subscriptions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
