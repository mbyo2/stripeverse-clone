
-- 1) USER ROLES
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can delete their own roles" ON public.user_roles;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Admins can manage roles') THEN
    CREATE POLICY "Admins can manage roles"
      ON public.user_roles
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role))
      WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user'::public.app_role)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

-- 2) MERCHANT INVOICES
DROP POLICY IF EXISTS "Anyone can view invoice by link" ON public.merchant_invoices;

-- 3) PAYMENT REQUESTS
DROP POLICY IF EXISTS "Anyone can view by payment link" ON public.payment_requests;
DROP POLICY IF EXISTS "Anyone can view payment requests by link" ON public.payment_requests;

-- 4) FRAUD RULES
DROP POLICY IF EXISTS "Authenticated users can view fraud rules" ON public.fraud_rules;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fraud_rules' AND policyname='Admins can view fraud rules') THEN
    CREATE POLICY "Admins can view fraud rules"
      ON public.fraud_rules
      FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END$$;

-- 5) MERCHANT ACCOUNTS: column-level security
REVOKE SELECT ON public.merchant_accounts FROM authenticated, anon;
GRANT SELECT (
  id, user_id, business_name, business_type, contact_info, address,
  registration_number, tax_id, status, verification_documents,
  webhook_url, api_key_masked, webhook_secret_masked,
  created_at, updated_at
) ON public.merchant_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.merchant_accounts TO authenticated;

-- 6) Drop permissive {public} role policies on system tables
DO $$
DECLARE
  r record;
  target_tables text[] := ARRAY[
    'billing_retry_queue', 'tier_limits', 'subscription_usage',
    'bnpl_plans', 'settlement_reports', 'webhook_delivery_logs',
    'invoices', 'subscription_invoices'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t) THEN
      FOR r IN
        SELECT pol.policyname
        FROM pg_policies pol
        WHERE pol.schemaname = 'public'
          AND pol.tablename = t
          AND 'public' = ANY(pol.roles)
          AND (
            pol.qual = 'true' OR pol.with_check = 'true'
            OR pol.policyname ILIKE '%service%'
            OR pol.policyname ILIKE '%system%'
          )
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
      END LOOP;
    END IF;
  END LOOP;
END$$;

-- 7) Make kyc-documents bucket private (storage policies already exist)
UPDATE storage.buckets SET public = false WHERE id = 'kyc-documents';
