-- Workstream A (auth & session audit), 2026-11-15.
--
-- ROOT CAUSE, proven live: public.log_enhanced_security_event() inserted a
-- notifications row with type 'security' for every event with risk_score >= 7,
-- but public.notifications has CHECK (type IN ('transaction','system','alert')).
-- The insert raised 23514 and aborted the whole function, rolling back the
-- security_events insert too. Consequence: EVERY high-risk security event
-- logged through this function was silently lost -- including
-- 'unauthorized_card_access' (risk 9) from log_card_access_attempt, which
-- made validate-card-access return 500 instead of 403 for unauthorized
-- card access and left no audit trail. Live proof: security_events held
-- zero rows with risk_score >= 7 before this fix.
--
-- Fix: (1) use the allowed type 'alert'; (2) wrap the notification insert
-- in its own exception block so a notification failure can NEVER roll back
-- the security event again (audit logging must be fail-safe, not fail-deadly).
-- CREATE OR REPLACE preserves the existing EXECUTE grants.

CREATE OR REPLACE FUNCTION public.log_enhanced_security_event(
  p_user_id uuid,
  p_event_type text,
  p_event_data jsonb DEFAULT '{}'::jsonb,
  p_ip_address inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text,
  p_risk_score integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Insert enhanced security event (must never be lost to a notification failure)
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

  -- Alert on high-risk events. 'alert' is one of the three types allowed by
  -- notifications_type_check (transaction/system/alert); the previous value
  -- 'security' violated it and aborted the whole function.
  IF p_risk_score >= 7 THEN
    BEGIN
      INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type
      ) VALUES (
        p_user_id,
        'Security Alert',
        'High-risk security event detected: ' || p_event_type,
        'alert'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'log_enhanced_security_event: notification insert failed for %: %', p_event_type, SQLERRM;
    END;
  END IF;
END;
$function$;
