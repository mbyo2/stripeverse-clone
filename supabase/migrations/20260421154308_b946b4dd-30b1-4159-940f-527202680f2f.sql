
-- Server-side authorization for sensitive admin/compliance tables.
-- Uses public.has_role() to enforce role checks at the database layer.

-- ============= AUDIT_LOGS: admin-only read; system-only writes =============
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Anyone can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Block client writes to audit logs" ON public.audit_logs;

CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block client writes to audit logs"
  ON public.audit_logs FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- ============= AML_SCREENINGS: admin-only =============
DROP POLICY IF EXISTS "Admins can view all AML screenings" ON public.aml_screenings;
DROP POLICY IF EXISTS "Admins can manage AML screenings" ON public.aml_screenings;
DROP POLICY IF EXISTS "Users can view their own AML screenings" ON public.aml_screenings;
DROP POLICY IF EXISTS "Anyone can view AML screenings" ON public.aml_screenings;

CREATE POLICY "Admins can view all AML screenings"
  ON public.aml_screenings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage AML screenings"
  ON public.aml_screenings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ============= FRAUD_RULES: admin or business (own merchant) =============
DROP POLICY IF EXISTS "Admins can manage all fraud rules" ON public.fraud_rules;
DROP POLICY IF EXISTS "Business users can view fraud rules" ON public.fraud_rules;
DROP POLICY IF EXISTS "Business users can manage their fraud rules" ON public.fraud_rules;
DROP POLICY IF EXISTS "Anyone can view fraud rules" ON public.fraud_rules;
DROP POLICY IF EXISTS "Authenticated users can view fraud rules" ON public.fraud_rules;

CREATE POLICY "Admins can manage all fraud rules"
  ON public.fraud_rules FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Business users can view their fraud rules"
  ON public.fraud_rules FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'business'::app_role)
    AND (merchant_id IS NULL OR merchant_id IN (
      SELECT id FROM public.merchant_accounts WHERE user_id = auth.uid()
    ))
  );

CREATE POLICY "Business users can manage their fraud rules"
  ON public.fraud_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'business'::app_role)
    AND merchant_id IN (
      SELECT id FROM public.merchant_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Business users can update their fraud rules"
  ON public.fraud_rules FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'business'::app_role)
    AND merchant_id IN (
      SELECT id FROM public.merchant_accounts WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'business'::app_role)
    AND merchant_id IN (
      SELECT id FROM public.merchant_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Business users can delete their fraud rules"
  ON public.fraud_rules FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'business'::app_role)
    AND merchant_id IN (
      SELECT id FROM public.merchant_accounts WHERE user_id = auth.uid()
    )
  );

-- ============= COMPLIANCE_CHECKS: admin can see all; users see own =============
DROP POLICY IF EXISTS "Admins can view all compliance checks" ON public.compliance_checks;
DROP POLICY IF EXISTS "Admins can manage compliance checks" ON public.compliance_checks;
DROP POLICY IF EXISTS "Users can view their own compliance checks" ON public.compliance_checks;

CREATE POLICY "Admins can view all compliance checks"
  ON public.compliance_checks FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage compliance checks"
  ON public.compliance_checks FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own compliance checks"
  ON public.compliance_checks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============= SECURITY_EVENTS: admin-only read; system writes =============
DROP POLICY IF EXISTS "Admins can view security events" ON public.security_events;
DROP POLICY IF EXISTS "Users can view their own security events" ON public.security_events;
DROP POLICY IF EXISTS "Block client writes to security events" ON public.security_events;

CREATE POLICY "Admins can view security events"
  ON public.security_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own security events"
  ON public.security_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Block client writes to security events"
  ON public.security_events FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- ============= ROLE_AUDIT: admin-only =============
DROP POLICY IF EXISTS "Admins can view role audit" ON public.role_audit;
DROP POLICY IF EXISTS "Users can view their own role audit" ON public.role_audit;
DROP POLICY IF EXISTS "Block client writes to role audit" ON public.role_audit;

CREATE POLICY "Admins can view role audit"
  ON public.role_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block client writes to role audit"
  ON public.role_audit FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- ============= ROLE_REQUESTS: users create own; admin reviews =============
DROP POLICY IF EXISTS "Users can create their own role requests" ON public.role_requests;
DROP POLICY IF EXISTS "Users can view their own role requests" ON public.role_requests;
DROP POLICY IF EXISTS "Admins can view all role requests" ON public.role_requests;
DROP POLICY IF EXISTS "Admins can update role requests" ON public.role_requests;

CREATE POLICY "Users can create their own role requests"
  ON public.role_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own role requests"
  ON public.role_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all role requests"
  ON public.role_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update role requests"
  ON public.role_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ============= USER_ROLES: users see own; admin manages =============
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can delete their own role" ON public.user_roles;

CREATE POLICY "Users can view their own role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
