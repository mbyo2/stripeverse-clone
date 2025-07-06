
-- Create transaction categories table
CREATE TABLE public.transaction_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT DEFAULT '#6B7280',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default categories
INSERT INTO public.transaction_categories (name, description, icon, color) VALUES
('Food & Dining', 'Restaurants, groceries, and food delivery', 'utensils', '#EF4444'),
('Transportation', 'Fuel, public transport, ride-sharing', 'car', '#3B82F6'),
('Shopping', 'Retail purchases, online shopping', 'shopping-bag', '#8B5CF6'),
('Bills & Utilities', 'Electricity, water, phone, internet', 'receipt', '#F59E0B'),
('Entertainment', 'Movies, games, subscriptions', 'gamepad-2', '#10B981'),
('Healthcare', 'Medical expenses, pharmacy', 'heart', '#EF4444'),
('Education', 'School fees, courses, books', 'graduation-cap', '#3B82F6'),
('Transfer', 'Money transfers, peer-to-peer payments', 'arrow-right-left', '#6B7280'),
('Investment', 'Savings, stocks, crypto', 'trending-up', '#059669'),
('Other', 'Miscellaneous expenses', 'more-horizontal', '#6B7280');

-- Create rewards system table
CREATE TABLE public.user_rewards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_points INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'bronze',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Create rewards transactions table to track point earning/spending
CREATE TABLE public.reward_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(uuid_id),
  points_earned INTEGER DEFAULT 0,
  points_spent INTEGER DEFAULT 0,
  action_type TEXT NOT NULL, -- 'earn', 'redeem', 'bonus', 'penalty'
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.transaction_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_transactions ENABLE ROW LEVEL SECURITY;

-- RLS policies for transaction_categories (public read)
CREATE POLICY "Anyone can view active categories"
ON public.transaction_categories FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage categories"
ON public.transaction_categories FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for user_rewards
CREATE POLICY "Users can view their own rewards"
ON public.user_rewards FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own rewards"
ON public.user_rewards FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "System can manage user rewards"
ON public.user_rewards FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for reward_transactions
CREATE POLICY "Users can view their own reward transactions"
ON public.reward_transactions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can manage reward transactions"
ON public.reward_transactions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to calculate and award points for transactions
CREATE OR REPLACE FUNCTION public.award_transaction_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  points_to_award INTEGER;
  user_tier TEXT;
BEGIN
  -- Only award points for completed transactions
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    -- Calculate points based on transaction amount (1 point per 10 ZMW)
    points_to_award := FLOOR(NEW.amount / 10);
    
    -- Bonus points for certain categories
    IF NEW.category IN ('Food & Dining', 'Transportation') THEN
      points_to_award := points_to_award * 2;
    END IF;
    
    -- Ensure minimum 1 point per transaction
    points_to_award := GREATEST(points_to_award, 1);
    
    -- Insert or update user rewards
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
    
    -- Record the reward transaction
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
$$;

-- Create trigger to award points on transaction completion
CREATE TRIGGER award_points_on_transaction
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.award_transaction_points();

-- Function to get user rewards info
CREATE OR REPLACE FUNCTION public.get_user_rewards(p_user_id UUID)
RETURNS TABLE(
  total_points INTEGER,
  lifetime_points INTEGER,
  tier TEXT,
  next_tier_threshold INTEGER,
  points_to_next_tier INTEGER
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
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
$$;

-- Update the existing get_spending_by_category function to use proper categories
CREATE OR REPLACE FUNCTION public.get_spending_by_category(p_user_id UUID)
RETURNS TABLE(
  category TEXT,
  amount NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
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
$$;
