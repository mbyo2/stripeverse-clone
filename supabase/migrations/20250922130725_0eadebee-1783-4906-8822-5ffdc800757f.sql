-- Ensure all necessary roles and role management is properly configured

-- 1. Add moderator role if it doesn't exist (it should be in the enum)
-- First check if we need to add any missing roles to the enum
DO $$ 
BEGIN
    -- Check if moderator role exists, if not add it
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'moderator' AND enumtypid = 'app_role'::regtype) THEN
        ALTER TYPE app_role ADD VALUE 'moderator';
    END IF;
END $$;

-- 2. Enhanced user creation trigger that assigns proper default roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Create profile first
  INSERT INTO public.profiles (id, first_name, last_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(NEW.raw_user_meta_data->>'first_name', profiles.first_name),
    last_name = COALESCE(NEW.raw_user_meta_data->>'last_name', profiles.last_name),
    phone = COALESCE(NEW.raw_user_meta_data->>'phone', profiles.phone),
    updated_at = NOW();
  
  -- Assign default role based on email or metadata
  -- Check if it's an admin email (you can customize this list)
  IF NEW.email IN ('admin@example.com', 'mbyotwo2@gmail.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  -- Check if it's a business account based on metadata
  ELSIF COALESCE(NEW.raw_user_meta_data->>'account_type', '') = 'business' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'business')
    ON CONFLICT (user_id, role) DO NOTHING;
  -- Check if it's a beta tester
  ELSIF COALESCE(NEW.raw_user_meta_data->>'is_beta_tester', 'false') = 'true' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'beta_tester')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    -- Default to regular user
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  -- Log the user creation
  PERFORM public.log_enhanced_security_event(
    NEW.id,
    'user_account_created',
    jsonb_build_object(
      'email', NEW.email,
      'role_assigned', CASE 
        WHEN NEW.email IN ('admin@example.com', 'mbyotwo2@gmail.com') THEN 'admin'
        WHEN COALESCE(NEW.raw_user_meta_data->>'account_type', '') = 'business' THEN 'business'
        WHEN COALESCE(NEW.raw_user_meta_data->>'is_beta_tester', 'false') = 'true' THEN 'beta_tester'
        ELSE 'user'
      END
    ),
    NULL,
    NULL,
    1
  );
  
  RETURN NEW;
END;
$$;

-- 3. Function to promote users to different roles (admin only)
CREATE OR REPLACE FUNCTION public.promote_user_role(
  p_target_user_id uuid,
  p_new_role app_role,
  p_reason text DEFAULT 'Role promotion'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_user_role app_role;
  target_user_current_role app_role;
BEGIN
  -- Get current user's role
  SELECT role INTO current_user_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Only admins can promote users
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only administrators can promote users';
  END IF;

  -- Get target user's current role
  SELECT role INTO target_user_current_role
  FROM public.user_roles
  WHERE user_id = p_target_user_id
  LIMIT 1;

  -- Prevent self-promotion for security
  IF auth.uid() = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot promote yourself';
  END IF;

  -- Use the secure role change function
  RETURN public.validate_role_change(
    p_target_user_id,
    p_new_role::text,
    auth.uid(),
    p_reason
  );
END;
$$;

-- 4. Function to check if user has any of multiple roles
CREATE OR REPLACE FUNCTION public.has_any_role(user_id uuid, required_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = $1
    AND role = ANY($2)
  );
$$;

-- 5. Function to get user's primary role
CREATE OR REPLACE FUNCTION public.get_user_primary_role(p_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = p_user_id
  ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'moderator' THEN 2
      WHEN 'business' THEN 3
      WHEN 'beta_tester' THEN 4
      WHEN 'user' THEN 5
    END
  LIMIT 1;
$$;

-- 6. Create default role assignments for existing users without roles
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'user'::app_role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON p.id = ur.user_id
WHERE ur.user_id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- 7. Ensure proper indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- 8. Create helper function for role-based access control in UI
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  user_role app_role;
  permissions jsonb := '{}';
BEGIN
  SELECT public.get_user_primary_role(p_user_id) INTO user_role;
  
  -- Define permissions based on role
  CASE user_role
    WHEN 'admin' THEN
      permissions := jsonb_build_object(
        'can_manage_users', true,
        'can_view_analytics', true,
        'can_manage_roles', true,
        'can_access_admin_panel', true,
        'can_manage_business_accounts', true,
        'can_view_all_transactions', true,
        'can_manage_compliance', true
      );
    WHEN 'moderator' THEN
      permissions := jsonb_build_object(
        'can_manage_users', true,
        'can_view_analytics', true,
        'can_manage_roles', false,
        'can_access_admin_panel', true,
        'can_manage_business_accounts', false,
        'can_view_all_transactions', false,
        'can_manage_compliance', false
      );
    WHEN 'business' THEN
      permissions := jsonb_build_object(
        'can_manage_users', false,
        'can_view_analytics', true,
        'can_manage_roles', false,
        'can_access_admin_panel', false,
        'can_manage_business_accounts', false,
        'can_view_all_transactions', false,
        'can_manage_compliance', false,
        'can_access_business_features', true,
        'can_use_api', true,
        'can_manage_webhooks', true
      );
    WHEN 'beta_tester' THEN
      permissions := jsonb_build_object(
        'can_manage_users', false,
        'can_view_analytics', false,
        'can_manage_roles', false,
        'can_access_admin_panel', false,
        'can_manage_business_accounts', false,
        'can_view_all_transactions', false,
        'can_manage_compliance', false,
        'can_access_beta_features', true,
        'can_submit_feedback', true
      );
    ELSE -- 'user'
      permissions := jsonb_build_object(
        'can_manage_users', false,
        'can_view_analytics', false,
        'can_manage_roles', false,
        'can_access_admin_panel', false,
        'can_manage_business_accounts', false,
        'can_view_all_transactions', false,
        'can_manage_compliance', false
      );
  END CASE;
  
  RETURN permissions || jsonb_build_object('role', user_role);
END;
$$;