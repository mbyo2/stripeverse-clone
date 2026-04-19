
-- beta_feedback
DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.beta_feedback;
CREATE POLICY "Anyone can submit feedback"
  ON public.beta_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(coalesce(title, '')) BETWEEN 1 AND 200
    AND length(coalesce(description, '')) BETWEEN 1 AND 5000
    AND length(coalesce(type, '')) BETWEEN 1 AND 50
    AND length(coalesce(app_version, '')) BETWEEN 1 AND 50
    AND (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
  );

-- contact_messages
DROP POLICY IF EXISTS "Anyone can submit contact messages" ON public.contact_messages;
CREATE POLICY "Anyone can submit contact messages"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(coalesce(name, '')) BETWEEN 1 AND 100
    AND length(coalesce(subject, '')) BETWEEN 1 AND 200
    AND length(coalesce(message, '')) BETWEEN 1 AND 5000
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email) <= 254
  );

-- newsletter_subscriptions
DROP POLICY IF EXISTS "Anyone can subscribe to newsletter" ON public.newsletter_subscriptions;
CREATE POLICY "Anyone can subscribe to newsletter"
  ON public.newsletter_subscriptions FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email) <= 254
  );
