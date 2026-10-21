-- Fix: login/signup rate limiting silently non-functional (three layers of
-- schema drift, all diagnosed and repaired live on project paymentgetway
-- (hhxwwozpvgktuqutfkhc) on 2026-10-21, each step proven before the next).
--
-- Layer 1 — SQLSTATE 42702 "column reference window_start is ambiguous":
-- check_advanced_rate_limit declared a local variable named window_start
-- while public.rate_limits has a column of the same name. Fixed by renaming
-- the variable to v_window_start and qualifying the column. (The app fails
-- open on RPC error, so this error alone disabled brute-force protection.)
--
-- Layer 2 — SQLSTATE 42P10: the function's INSERT ... ON CONFLICT
-- (identifier, action, window_start) had no matching unique constraint —
-- the designed UNIQUE(identifier, action, window_start) was missing live.
-- Restored below.
--
-- Layer 3 — SQLSTATE 23505: a stray UNIQUE(identifier, action) constraint
-- (rate_limits_identifier_action_key, not in the original design) made a
-- second time-window row for the same identifier+action impossible.
-- Dropped below; the final live constraint set is the primary key plus
-- the designed 3-column unique, exactly as in migration 20250701103927.
--
-- Proof after repair: three probe calls with max_attempts=2 returned
-- true, true, false; probe rows deleted afterwards.

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
  v_window_start timestamp with time zone;
BEGIN
  v_window_start := date_trunc('minute', now()) - INTERVAL '1 minute' * p_window_minutes;

  SELECT COALESCE(SUM(attempts), 0) INTO current_attempts
  FROM public.rate_limits
  WHERE identifier = p_identifier
    AND action = p_action
    AND rate_limits.window_start >= v_window_start;

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
      8
    );
    RETURN false;
  END IF;

  INSERT INTO public.rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, date_trunc('minute', now()))
  ON CONFLICT (identifier, action, window_start)
  DO UPDATE SET attempts = rate_limits.attempts + 1;

  RETURN true;
END;
$$;

ALTER TABLE public.rate_limits
  ADD CONSTRAINT rate_limits_identifier_action_window_start_key
  UNIQUE (identifier, action, window_start);

ALTER TABLE public.rate_limits
  DROP CONSTRAINT rate_limits_identifier_action_key;
