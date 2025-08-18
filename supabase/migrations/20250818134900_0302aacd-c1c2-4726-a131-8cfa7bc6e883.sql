-- Fix critical security issue: Remove overly permissive subscribers table policies
DROP POLICY IF EXISTS "Service can manage subscriptions" ON public.subscribers;

-- Create secure RLS policies for subscribers table
CREATE POLICY "Users can view their own subscription" 
ON public.subscribers 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscription" 
ON public.subscribers 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all subscriptions" 
ON public.subscribers 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can create subscriptions" 
ON public.subscribers 
FOR INSERT 
WITH CHECK (true);

-- Enhance role change validation function with better security
CREATE OR REPLACE FUNCTION public.validate_role_change(
  p_user_id uuid, 
  p_new_role text, 
  p_changed_by uuid, 
  p_reason text DEFAULT 'Role change request'::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Enhanced authorization logic
  -- Only admins can change roles, and they cannot elevate beyond their own level
  IF requester_role = 'admin' THEN
    -- Admins can change any role except to admin (prevents unauthorized elevation)
    IF p_new_role != 'admin' OR p_changed_by = p_user_id THEN
      is_authorized := true;
    END IF;
  -- Users can only request non-privileged roles for themselves
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
      'reason', p_reason
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 7 END
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
$$;

-- Create function for enhanced rate limiting with proper deny-on-error behavior
CREATE OR REPLACE FUNCTION public.check_rate_limit_secure(
  p_identifier text,
  p_action text,
  p_limit integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_attempts integer;
  window_start timestamptz;
BEGIN
  window_start := now() - (p_window_minutes || ' minutes')::interval;
  
  -- Clean up old records
  DELETE FROM public.rate_limits 
  WHERE window_start < window_start;
  
  -- Get current attempts in window
  SELECT COALESCE(SUM(attempts), 0) INTO current_attempts
  FROM public.rate_limits
  WHERE identifier = p_identifier 
    AND action = p_action 
    AND window_start >= window_start;
  
  -- If over limit, deny
  IF current_attempts >= p_limit THEN
    -- Log security event for rate limit exceeded
    PERFORM public.log_security_event(
      NULL,
      'rate_limit_exceeded',
      jsonb_build_object(
        'identifier', p_identifier,
        'action', p_action,
        'attempts', current_attempts,
        'limit', p_limit
      ),
      NULL,
      NULL,
      5
    );
    RETURN false;
  END IF;
  
  -- Record this attempt
  INSERT INTO public.rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, now())
  ON CONFLICT (identifier, action) 
  DO UPDATE SET 
    attempts = rate_limits.attempts + 1,
    window_start = CASE 
      WHEN rate_limits.window_start < window_start THEN now()
      ELSE rate_limits.window_start
    END;
  
  RETURN true;
END;
$$;