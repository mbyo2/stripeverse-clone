-- Create table for tracking used TOTP tokens to prevent replay attacks
CREATE TABLE IF NOT EXISTS public.used_totp_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on used_totp_tokens
ALTER TABLE public.used_totp_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for used_totp_tokens
CREATE POLICY "Users can insert their own used tokens" 
ON public.used_totp_tokens 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own used tokens" 
ON public.used_totp_tokens 
FOR SELECT 
USING (auth.uid() = user_id);

-- Create cleanup function for old used tokens
CREATE OR REPLACE FUNCTION public.cleanup_old_totp_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.used_totp_tokens
  WHERE used_at < now() - INTERVAL '2 minutes';
END;
$function$;

-- Add enhanced security logging table
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  event_type TEXT NOT NULL,
  event_data JSONB,
  ip_address INET,
  user_agent TEXT,
  risk_score INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on security_events
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for security_events
CREATE POLICY "Admins can view all security events" 
ON public.security_events 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert security events" 
ON public.security_events 
FOR INSERT 
WITH CHECK (true);

-- Create function to log security events
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_event_data JSONB DEFAULT '{}',
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_risk_score INTEGER DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.security_events (
    user_id,
    event_type,
    event_data,
    ip_address,
    user_agent,
    risk_score
  ) VALUES (
    p_user_id,
    p_event_type,
    p_event_data,
    p_ip_address,
    p_user_agent,
    p_risk_score
  );
END;
$function$;

-- Create role audit table for tracking role changes
CREATE TABLE IF NOT EXISTS public.role_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  old_role TEXT,
  new_role TEXT,
  changed_by UUID,
  reason TEXT,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on role_audit
ALTER TABLE public.role_audit ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for role_audit
CREATE POLICY "Admins can view all role audits" 
ON public.role_audit 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert role audits" 
ON public.role_audit 
FOR INSERT 
WITH CHECK (true);

-- Create function to validate and log role changes
CREATE OR REPLACE FUNCTION public.validate_role_change(
  p_user_id UUID,
  p_new_role TEXT,
  p_changed_by UUID,
  p_reason TEXT DEFAULT 'Role change request'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  current_role TEXT;
  is_authorized BOOLEAN := false;
BEGIN
  -- Get current role
  SELECT role INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Check if the person making the change is authorized
  SELECT has_role(p_changed_by, 'admin'::app_role) INTO is_authorized;

  -- Log the role change attempt
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

  -- Log security event
  PERFORM public.log_security_event(
    p_user_id,
    'role_change_attempt',
    jsonb_build_object(
      'old_role', current_role,
      'new_role', p_new_role,
      'changed_by', p_changed_by,
      'authorized', is_authorized
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 5 END
  );

  RETURN is_authorized;
END;
$function$;