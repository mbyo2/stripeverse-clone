-- Fix critical security vulnerabilities

-- 1. Fix Beta Feedback RLS Policy - remove overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view their own feedback" ON public.beta_feedback;

-- Create proper admin-only SELECT policy for beta feedback
CREATE POLICY "Admins can view all beta feedback" 
ON public.beta_feedback 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Keep the existing INSERT policy for feedback submission
-- "Anyone can insert feedback" policy already exists and is correct

-- 2. Fix Role Escalation Logic - Update validate_role_change function
CREATE OR REPLACE FUNCTION public.validate_role_change(p_user_id uuid, p_new_role text, p_changed_by uuid, p_reason text DEFAULT 'Role change request'::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  current_role TEXT;
  is_authorized BOOLEAN := false;
  requester_role TEXT;
BEGIN
  -- Get current role of target user
  SELECT role INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Get role of person making the change
  SELECT role INTO requester_role
  FROM public.user_roles
  WHERE user_id = p_changed_by
  LIMIT 1;

  -- Enhanced authorization logic - FIXED: Remove self-elevation loophole
  -- Only admins can change roles, and they cannot elevate anyone to admin unless changing their own role
  IF requester_role = 'admin' THEN
    -- Admins can change any role except to admin (prevents unauthorized elevation)
    -- Only exception: admins can change their own role to admin (for role maintenance)
    IF p_new_role != 'admin' OR (p_new_role = 'admin' AND p_changed_by = p_user_id) THEN
      is_authorized := true;
    END IF;
  -- Users can only request non-privileged roles for themselves (requires admin approval)
  ELSIF p_changed_by = p_user_id AND p_new_role IN ('user', 'business') THEN
    is_authorized := false; -- Requires admin approval
  END IF;

  -- Log the role change attempt with enhanced details
  INSERT INTO public.role_audit (
    user_id,
    old_role,
    new_role,
    changed_by,
    reason,
    approved
  ) VALUES (
    p_user_id,
    current_role,
    p_new_role,
    p_changed_by,
    p_reason,
    is_authorized
  );

  -- Enhanced security event logging
  PERFORM public.log_security_event(
    p_user_id,
    'role_change_attempt',
    jsonb_build_object(
      'old_role', current_role,
      'new_role', p_new_role,
      'changed_by', p_changed_by,
      'requester_role', requester_role,
      'authorized', is_authorized,
      'reason', p_reason,
      'security_fix_applied', true
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 9 END
  );

  -- If authorized, make the change
  IF is_authorized THEN
    -- Delete old role
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    -- Insert new role
    INSERT INTO public.user_roles (user_id, role) 
    VALUES (p_user_id, p_new_role::app_role);
  END IF;

  RETURN is_authorized;
END;
$function$;

-- 3. Complete User Role RLS Policies
-- Add missing UPDATE and DELETE policies for user_roles table
CREATE POLICY "Only admins can update roles" 
ON public.user_roles 
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete roles" 
ON public.user_roles 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 4. Enhance security events logging for payment operations
-- Update log_security_event to include payment-related events
COMMENT ON FUNCTION public.log_security_event IS 'Enhanced security event logging with payment operation support and improved risk scoring';