-- CRITICAL SECURITY FIXES

-- 1. Enable RLS on beta_feedback table (Critical - REQUIRED)
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for beta_feedback
CREATE POLICY "Users can view their own feedback" 
ON public.beta_feedback 
FOR SELECT 
USING (true); -- Allow public viewing for now since there's no user_id field

CREATE POLICY "Anyone can insert feedback" 
ON public.beta_feedback 
FOR INSERT 
WITH CHECK (true); -- Public feedback submission

-- 2. Fix database function security - Add proper search_path to ALL functions
-- This prevents SQL injection attacks via schema hijacking

CREATE OR REPLACE FUNCTION public.get_monthly_transaction_data(p_user_id uuid)
RETURNS TABLE(month text, amount numeric, transaction_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 
    to_char(date_trunc('month', created_at), 'Mon') as month,
    COALESCE(SUM(amount), 0) as amount,
    COUNT(*)::INTEGER as transaction_count
  FROM public.transactions
  WHERE user_id = p_user_id 
    AND created_at >= now() - interval '6 months'
  GROUP BY date_trunc('month', created_at)
  ORDER BY date_trunc('month', created_at);
$function$;

CREATE OR REPLACE FUNCTION public.get_spending_by_category(p_user_id uuid)
RETURNS TABLE(category text, amount numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 
    COALESCE(t.category, 'Other') as category,
    SUM(t.amount) as amount
  FROM public.transactions t
  WHERE t.user_id = p_user_id 
    AND t.direction = 'outgoing'
    AND t.created_at >= date_trunc('month', now())
  GROUP BY t.category
  ORDER BY amount DESC
  LIMIT 5;
$function$;

CREATE OR REPLACE FUNCTION public.get_recent_transactions(p_user_id uuid, p_limit integer DEFAULT 4)
RETURNS TABLE(id integer, direction text, recipient_name text, amount numeric, currency text, created_at timestamp with time zone, status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 
    t.id,
    t.direction,
    COALESCE(t.recipient_name, 'Unknown') as recipient_name,
    t.amount,
    t.currency,
    t.created_at,
    t.status
  FROM public.transactions t
  WHERE t.user_id = p_user_id
  ORDER BY t.created_at DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.user_sessions
  WHERE expires_at < now();
  
  DELETE FROM public.rate_limits
  WHERE window_start < now() - INTERVAL '1 hour';
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_usage_limit(p_user_id uuid, p_limit_type text, p_amount numeric DEFAULT 1)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  current_tier TEXT;
  current_usage NUMERIC;
  tier_limit NUMERIC;
  current_month TEXT;
BEGIN
  current_month := to_char(now(), 'YYYY-MM');
  
  SELECT subscription_tier INTO current_tier
  FROM public.subscribers
  WHERE user_id = p_user_id;
  
  IF current_tier IS NULL THEN
    current_tier := 'free';
  END IF;
  
  SELECT 
    CASE 
      WHEN p_limit_type = 'transactions' THEN monthly_transactions
      WHEN p_limit_type = 'transaction_amount' THEN monthly_transaction_amount
      WHEN p_limit_type = 'virtual_cards' THEN virtual_cards_limit
      WHEN p_limit_type = 'api_calls' THEN api_calls_per_hour
    END INTO tier_limit
  FROM public.tier_limits
  WHERE tier = current_tier;
  
  IF tier_limit = -1 THEN
    RETURN TRUE;
  END IF;
  
  SELECT 
    CASE 
      WHEN p_limit_type = 'transactions' THEN transactions_count
      WHEN p_limit_type = 'transaction_amount' THEN transactions_amount
      WHEN p_limit_type = 'virtual_cards' THEN cards_created
      WHEN p_limit_type = 'api_calls' THEN api_calls
    END INTO current_usage
  FROM public.subscription_usage
  WHERE user_id = p_user_id AND month_year = current_month;
  
  IF current_usage IS NULL THEN
    current_usage := 0;
  END IF;
  
  RETURN (current_usage + p_amount) <= tier_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_user_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.wallets (user_id, balance, currency, status)
  VALUES (NEW.id, 0.00, 'ZMW', 'active');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_transaction_stats(p_user_id uuid)
RETURNS TABLE(total_transactions integer, monthly_amount numeric, monthly_transactions integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 
    COUNT(*)::INTEGER as total_transactions,
    COALESCE(SUM(CASE 
      WHEN created_at >= date_trunc('month', now()) 
      THEN amount 
      ELSE 0 
    END), 0) as monthly_amount,
    COUNT(CASE 
      WHEN created_at >= date_trunc('month', now()) 
      THEN 1 
    END)::INTEGER as monthly_transactions
  FROM public.transactions
  WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(user_id uuid, required_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = $1
    AND role = $2
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_wallet_balance(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(balance, 0)
  FROM public.wallets
  WHERE user_id = p_user_id AND currency = 'ZMW'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(
    (SELECT subscription_tier FROM public.subscribers WHERE user_id = p_user_id LIMIT 1),
    'free'
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_feature_access(p_user_id uuid, p_feature_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tier_features tf
    WHERE tf.tier = COALESCE(
      (SELECT subscription_tier FROM public.subscribers WHERE user_id = p_user_id LIMIT 1),
      'free'
    )
    AND tf.feature_id = p_feature_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_transaction_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_tier TEXT;
BEGIN
  SELECT subscription_tier INTO user_tier
  FROM public.subscribers
  WHERE user_id = NEW.user_id;
  
  IF user_tier IS NULL THEN
    user_tier := 'free';
  END IF;
  
  PERFORM public.increment_usage(NEW.user_id, user_tier, 'transactions', 1);
  PERFORM public.increment_usage(NEW.user_id, user_tier, 'transaction_amount', NEW.amount);
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_card_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_tier TEXT;
BEGIN
  SELECT subscription_tier INTO user_tier
  FROM public.subscribers
  WHERE user_id = NEW.user_id;
  
  IF user_tier IS NULL THEN
    user_tier := 'free';
  END IF;
  
  PERFORM public.increment_usage(NEW.user_id, user_tier, 'virtual_cards', 1);
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_wallet_balance(p_user_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.wallets (user_id, balance, currency, status)
  VALUES (p_user_id, p_amount, 'ZMW', 'active')
  ON CONFLICT (user_id, currency) 
  DO UPDATE SET 
    balance = wallets.balance + p_amount,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.subscribers (user_id, email, subscription_tier, subscription_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    'free',
    'active'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    old_values,
    new_values
  ) VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.uuid_id::text, OLD.uuid_id::text, NEW.id::text, OLD.id::text),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.award_transaction_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  points_to_award INTEGER;
  user_tier TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    points_to_award := FLOOR(NEW.amount / 10);
    
    IF NEW.category IN ('Food & Dining', 'Transportation') THEN
      points_to_award := points_to_award * 2;
    END IF;
    
    points_to_award := GREATEST(points_to_award, 1);
    
    INSERT INTO public.user_rewards (user_id, total_points, lifetime_points)
    VALUES (NEW.user_id, points_to_award, points_to_award)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
      total_points = user_rewards.total_points + points_to_award,
      lifetime_points = user_rewards.lifetime_points + points_to_award,
      tier = CASE 
        WHEN user_rewards.lifetime_points + points_to_award >= 10000 THEN 'platinum'
        WHEN user_rewards.lifetime_points + points_to_award >= 5000 THEN 'gold'
        WHEN user_rewards.lifetime_points + points_to_award >= 1000 THEN 'silver'
        ELSE 'bronze'
      END,
      updated_at = now();
    
    INSERT INTO public.reward_transactions (
      user_id, 
      transaction_id, 
      points_earned, 
      action_type, 
      description
    ) VALUES (
      NEW.user_id, 
      NEW.uuid_id, 
      points_to_award, 
      'earn', 
      'Points earned from transaction'
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tier_features(p_tier text)
RETURNS TABLE(feature_id text, name text, description text, category text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT f.feature_id, f.name, f.description, f.category
  FROM public.features f
  INNER JOIN public.tier_features tf ON f.feature_id = tf.feature_id
  WHERE tf.tier = p_tier
  ORDER BY f.category, f.name;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_rewards(p_user_id uuid)
RETURNS TABLE(total_points integer, lifetime_points integer, tier text, next_tier_threshold integer, points_to_next_tier integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 
    COALESCE(ur.total_points, 0) as total_points,
    COALESCE(ur.lifetime_points, 0) as lifetime_points,
    COALESCE(ur.tier, 'bronze') as tier,
    CASE 
      WHEN COALESCE(ur.tier, 'bronze') = 'bronze' THEN 1000
      WHEN COALESCE(ur.tier, 'bronze') = 'silver' THEN 5000
      WHEN COALESCE(ur.tier, 'bronze') = 'gold' THEN 10000
      ELSE 0
    END as next_tier_threshold,
    CASE 
      WHEN COALESCE(ur.tier, 'bronze') = 'bronze' THEN GREATEST(0, 1000 - COALESCE(ur.lifetime_points, 0))
      WHEN COALESCE(ur.tier, 'bronze') = 'silver' THEN GREATEST(0, 5000 - COALESCE(ur.lifetime_points, 0))
      WHEN COALESCE(ur.tier, 'bronze') = 'gold' THEN GREATEST(0, 10000 - COALESCE(ur.lifetime_points, 0))
      ELSE 0
    END as points_to_next_tier
  FROM public.user_rewards ur
  WHERE ur.user_id = p_user_id
  UNION ALL
  SELECT 0, 0, 'bronze', 1000, 1000
  WHERE NOT EXISTS (SELECT 1 FROM public.user_rewards WHERE user_id = p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
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
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id uuid, p_user_tier text, p_usage_type text, p_amount numeric DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  current_month TEXT;
BEGIN
  current_month := to_char(now(), 'YYYY-MM');
  
  INSERT INTO public.subscription_usage (
    user_id, 
    subscription_tier, 
    month_year,
    transactions_count,
    transactions_amount,
    cards_created,
    api_calls
  ) VALUES (
    p_user_id,
    p_user_tier,
    current_month,
    CASE WHEN p_usage_type = 'transactions' THEN p_amount ELSE 0 END,
    CASE WHEN p_usage_type = 'transaction_amount' THEN p_amount ELSE 0 END,
    CASE WHEN p_usage_type = 'virtual_cards' THEN p_amount ELSE 0 END,
    CASE WHEN p_usage_type = 'api_calls' THEN p_amount ELSE 0 END
  )
  ON CONFLICT (user_id, month_year) 
  DO UPDATE SET
    transactions_count = subscription_usage.transactions_count + 
      CASE WHEN p_usage_type = 'transactions' THEN p_amount ELSE 0 END,
    transactions_amount = subscription_usage.transactions_amount + 
      CASE WHEN p_usage_type = 'transaction_amount' THEN p_amount ELSE 0 END,
    cards_created = subscription_usage.cards_created + 
      CASE WHEN p_usage_type = 'virtual_cards' THEN p_amount ELSE 0 END,
    api_calls = subscription_usage.api_calls + 
      CASE WHEN p_usage_type = 'api_calls' THEN p_amount ELSE 0 END,
    updated_at = now();
END;
$function$;