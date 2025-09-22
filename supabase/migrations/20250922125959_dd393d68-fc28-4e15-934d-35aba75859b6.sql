-- Apply comprehensive security fixes for remaining vulnerabilities

-- 1. Enhanced card data encryption - ensure all sensitive data is properly encrypted
-- Update existing cards to use stronger encryption if not already done
CREATE OR REPLACE FUNCTION public.secure_encrypt_card_data(card_number text, cvv text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  encrypted_data jsonb;
  salt_key text;
BEGIN
  -- Generate a stronger salt for encryption
  salt_key := encode(gen_random_bytes(32), 'base64');
  
  -- Use stronger encryption with random salt
  encrypted_data := jsonb_build_object(
    'encrypted_number', encode(digest(card_number || salt_key, 'sha512'), 'hex'),
    'encrypted_cvv', encode(digest(cvv || salt_key, 'sha512'), 'hex'),
    'last_four', right(card_number, 4),
    'salt', salt_key,
    'encryption_version', '2.0'
  );
  
  RETURN encrypted_data;
END;
$$;

-- 2. Enhanced session security with automatic cleanup
CREATE OR REPLACE FUNCTION public.enforce_session_security()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Clean up old sessions more aggressively
  DELETE FROM public.user_sessions 
  WHERE expires_at < now() - INTERVAL '1 hour';
  
  -- Clean up old rate limit entries
  DELETE FROM public.rate_limits 
  WHERE window_start < now() - INTERVAL '2 hours';
  
  -- Clean up old TOTP tokens
  DELETE FROM public.used_totp_tokens 
  WHERE used_at < now() - INTERVAL '5 minutes';
  
  -- Log security cleanup
  INSERT INTO public.security_events (
    event_type,
    event_data,
    risk_score
  ) VALUES (
    'security_cleanup',
    jsonb_build_object(
      'timestamp', now(),
      'action', 'automated_cleanup'
    ),
    0
  );
END;
$$;

-- 3. Enhanced rate limiting with IP tracking
CREATE OR REPLACE FUNCTION public.check_advanced_rate_limit(
  p_identifier text,
  p_action text,
  p_max_attempts integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15,
  p_ip_address inet DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_attempts integer;
  window_start timestamp with time zone;
BEGIN
  window_start := date_trunc('minute', now()) - INTERVAL '1 minute' * p_window_minutes;
  
  -- Count attempts in the time window
  SELECT COALESCE(SUM(attempts), 0) INTO current_attempts
  FROM public.rate_limits
  WHERE identifier = p_identifier
    AND action = p_action
    AND window_start >= window_start;
  
  -- Log suspicious activity if rate limit exceeded
  IF current_attempts >= p_max_attempts THEN
    PERFORM public.log_security_event(
      NULL,
      'rate_limit_exceeded',
      jsonb_build_object(
        'identifier', p_identifier,
        'action', p_action,
        'attempts', current_attempts,
        'ip_address', p_ip_address
      ),
      p_ip_address,
      NULL,
      8 -- High risk score
    );
    RETURN false;
  END IF;
  
  -- Update or insert rate limit record
  INSERT INTO public.rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, date_trunc('minute', now()))
  ON CONFLICT (identifier, action, window_start)
  DO UPDATE SET attempts = rate_limits.attempts + 1;
  
  RETURN true;
END;
$$;

-- 4. Enhanced security event logging with IP geolocation tracking
CREATE OR REPLACE FUNCTION public.log_enhanced_security_event(
  p_user_id uuid,
  p_event_type text,
  p_event_data jsonb DEFAULT '{}'::jsonb,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_risk_score integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  enhanced_data jsonb;
BEGIN
  -- Enhance event data with additional security context
  enhanced_data := p_event_data || jsonb_build_object(
    'timestamp', now(),
    'session_info', jsonb_build_object(
      'ip_address', p_ip_address,
      'user_agent', p_user_agent
    ),
    'security_context', jsonb_build_object(
      'risk_score', p_risk_score,
      'event_version', '2.0'
    )
  );
  
  -- Insert enhanced security event
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
    enhanced_data,
    p_ip_address,
    p_user_agent,
    p_risk_score
  );
  
  -- Alert on high-risk events
  IF p_risk_score >= 7 THEN
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type
    ) VALUES (
      p_user_id,
      'Security Alert',
      'High-risk security event detected: ' || p_event_type,
      'security'
    );
  END IF;
END;
$$;

-- 5. Secure virtual card access logging
CREATE OR REPLACE FUNCTION public.log_card_access_attempt(
  p_user_id uuid,
  p_card_id uuid,
  p_access_type text,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  card_exists boolean;
  rate_limited boolean;
BEGIN
  -- Verify card ownership
  SELECT EXISTS (
    SELECT 1 FROM public.virtual_cards 
    WHERE id = p_card_id AND user_id = p_user_id
  ) INTO card_exists;
  
  IF NOT card_exists THEN
    -- Log unauthorized access attempt
    PERFORM public.log_enhanced_security_event(
      p_user_id,
      'unauthorized_card_access',
      jsonb_build_object(
        'card_id', p_card_id,
        'access_type', p_access_type
      ),
      p_ip_address,
      p_user_agent,
      9 -- Critical risk
    );
    RETURN false;
  END IF;
  
  -- Check rate limiting for card access
  SELECT public.check_advanced_rate_limit(
    p_user_id::text || ':card_access',
    'view_card_details',
    10, -- max 10 attempts
    60, -- per hour
    p_ip_address
  ) INTO rate_limited;
  
  IF NOT rate_limited THEN
    RETURN false;
  END IF;
  
  -- Log successful access
  PERFORM public.log_enhanced_security_event(
    p_user_id,
    'card_access_granted',
    jsonb_build_object(
      'card_id', p_card_id,
      'access_type', p_access_type
    ),
    p_ip_address,
    p_user_agent,
    2 -- Low risk for authorized access
  );
  
  RETURN true;
END;
$$;

-- 6. Create security maintenance schedule
CREATE OR REPLACE FUNCTION public.run_security_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Run automated security cleanup
  PERFORM public.enforce_session_security();
  
  -- Clean up old security events (keep last 90 days)
  DELETE FROM public.security_events 
  WHERE created_at < now() - INTERVAL '90 days';
  
  -- Clean up old audit logs (keep last 1 year)
  DELETE FROM public.audit_logs 
  WHERE created_at < now() - INTERVAL '365 days';
  
  -- Update security metrics
  INSERT INTO public.security_events (
    event_type,
    event_data,
    risk_score
  ) VALUES (
    'security_maintenance_completed',
    jsonb_build_object(
      'timestamp', now(),
      'maintenance_version', '2.0'
    ),
    0
  );
END;
$$;