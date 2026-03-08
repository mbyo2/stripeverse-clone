
-- Billing retry queue for failed charges
CREATE TABLE public.billing_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  subscription_tier text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  next_retry_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error text,
  status text NOT NULL DEFAULT 'pending', -- pending, processing, succeeded, failed, abandoned
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can manage billing retries" ON public.billing_retry_queue
  FOR ALL USING (true);

CREATE POLICY "Users can view their own retries" ON public.billing_retry_queue
  FOR SELECT USING (auth.uid() = user_id);

-- Add payment_method_type to subscribers for native billing
ALTER TABLE public.subscribers 
  ADD COLUMN IF NOT EXISTS next_billing_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS billing_interval text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS last_billing_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS failed_payment_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dunning_status text DEFAULT 'none'; -- none, warning, grace_period, suspended

-- Function to process recurring billing for a single subscriber
CREATE OR REPLACE FUNCTION public.process_subscriber_billing(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub RECORD;
  v_price numeric;
  v_invoice_id uuid;
  v_period_start timestamp with time zone;
  v_period_end timestamp with time zone;
BEGIN
  -- Get subscriber info
  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id;
  
  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscriber not found');
  END IF;
  
  IF v_sub.subscription_tier = 'free' OR v_sub.subscription_status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'No billable subscription');
  END IF;
  
  -- Get tier price
  SELECT price INTO v_price FROM public.pricing_tiers 
  WHERE tier_name = v_sub.subscription_tier AND is_active = true;
  
  IF v_price IS NULL OR v_price = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No price found for tier');
  END IF;
  
  -- Calculate billing period
  v_period_start := COALESCE(v_sub.next_billing_date, now());
  v_period_end := v_period_start + INTERVAL '1 month';
  
  -- Create invoice
  INSERT INTO public.subscription_invoices (
    user_id, subscription_tier, amount, currency,
    billing_period_start, billing_period_end, status
  ) VALUES (
    v_sub.user_id, v_sub.subscription_tier, v_price, 
    COALESCE((SELECT currency FROM public.pricing_tiers WHERE tier_name = v_sub.subscription_tier LIMIT 1), 'USD'),
    v_period_start, v_period_end, 'pending'
  ) RETURNING id INTO v_invoice_id;
  
  -- Update subscriber billing dates
  UPDATE public.subscribers SET
    last_billing_date = now(),
    next_billing_date = v_period_end,
    subscription_start = COALESCE(subscription_start, v_period_start),
    subscription_end = v_period_end,
    updated_at = now()
  WHERE id = p_subscriber_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'amount', v_price,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
END;
$$;

-- Function to handle subscription tier changes with proration
CREATE OR REPLACE FUNCTION public.change_subscription_tier(
  p_user_id uuid,
  p_new_tier text,
  p_prorate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub RECORD;
  v_old_price numeric;
  v_new_price numeric;
  v_proration_credit numeric := 0;
  v_days_remaining integer;
  v_days_in_period integer;
BEGIN
  -- Get current subscription
  SELECT * INTO v_sub FROM public.subscribers WHERE user_id = p_user_id LIMIT 1;
  
  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No subscription found');
  END IF;
  
  -- Get prices
  SELECT price INTO v_old_price FROM public.pricing_tiers WHERE tier_name = v_sub.subscription_tier AND is_active = true;
  SELECT price INTO v_new_price FROM public.pricing_tiers WHERE tier_name = p_new_tier AND is_active = true;
  
  IF v_new_price IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;
  
  -- Calculate proration if upgrading mid-cycle
  IF p_prorate AND v_sub.subscription_end IS NOT NULL AND v_old_price IS NOT NULL AND v_old_price > 0 THEN
    v_days_remaining := GREATEST(0, EXTRACT(DAY FROM v_sub.subscription_end - now())::integer);
    v_days_in_period := GREATEST(1, EXTRACT(DAY FROM v_sub.subscription_end - COALESCE(v_sub.last_billing_date, v_sub.subscription_start, now()))::integer);
    v_proration_credit := ROUND((v_old_price * v_days_remaining / v_days_in_period), 2);
  END IF;
  
  -- Update subscription
  UPDATE public.subscribers SET
    subscription_tier = p_new_tier,
    subscription_status = CASE WHEN p_new_tier = 'free' THEN 'active' ELSE subscription_status END,
    updated_at = now(),
    failed_payment_count = 0,
    dunning_status = 'none'
  WHERE user_id = p_user_id;
  
  -- Log the change
  PERFORM public.log_security_event(
    p_user_id,
    'subscription_changed',
    jsonb_build_object(
      'old_tier', v_sub.subscription_tier,
      'new_tier', p_new_tier,
      'proration_credit', v_proration_credit,
      'old_price', v_old_price,
      'new_price', v_new_price
    ),
    NULL, NULL, 1
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'old_tier', v_sub.subscription_tier,
    'new_tier', p_new_tier,
    'proration_credit', v_proration_credit,
    'new_price', v_new_price,
    'amount_due', GREATEST(0, COALESCE(v_new_price, 0) - v_proration_credit)
  );
END;
$$;

-- Function to handle dunning (failed payment escalation)
CREATE OR REPLACE FUNCTION public.process_dunning(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub RECORD;
BEGIN
  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id;
  
  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscriber not found');
  END IF;
  
  -- Escalate dunning based on failed payment count
  IF v_sub.failed_payment_count >= 3 THEN
    -- Suspend after 3 failures
    UPDATE public.subscribers SET
      subscription_status = 'suspended',
      dunning_status = 'suspended',
      updated_at = now()
    WHERE id = p_subscriber_id;
    
    -- Notify user
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (v_sub.user_id, 'Subscription Suspended', 
      'Your subscription has been suspended due to repeated payment failures. Please update your payment method.', 
      'billing');
    
    RETURN jsonb_build_object('success', true, 'action', 'suspended');
    
  ELSIF v_sub.failed_payment_count >= 2 THEN
    -- Grace period warning
    UPDATE public.subscribers SET
      dunning_status = 'grace_period',
      updated_at = now()
    WHERE id = p_subscriber_id;
    
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (v_sub.user_id, 'Payment Grace Period', 
      'Your payment has failed twice. Your subscription will be suspended if payment is not received soon.', 
      'billing');
    
    RETURN jsonb_build_object('success', true, 'action', 'grace_period');
    
  ELSIF v_sub.failed_payment_count >= 1 THEN
    UPDATE public.subscribers SET
      dunning_status = 'warning',
      updated_at = now()
    WHERE id = p_subscriber_id;
    
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (v_sub.user_id, 'Payment Failed', 
      'We were unable to process your subscription payment. We will retry shortly.', 
      'billing');
    
    RETURN jsonb_build_object('success', true, 'action', 'warning');
  END IF;
  
  RETURN jsonb_build_object('success', true, 'action', 'none');
END;
$$;
