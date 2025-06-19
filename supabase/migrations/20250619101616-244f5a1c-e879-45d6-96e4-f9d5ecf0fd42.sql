
-- Create a table to define all available features in the system
CREATE TABLE public.features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert the features that are currently shown in the UI
INSERT INTO public.features (feature_id, name, description, category) VALUES
('dashboard_access', 'Dashboard Access', 'Access to main dashboard', 'Core'),
('feedback_submission', 'Feedback Submission', 'Submit feedback and suggestions', 'Core'),
('transfers', 'Money Transfers', 'Send money with competitive rates', 'Payment'),
('virtual_cards', 'Virtual Cards', 'Create and manage virtual debit cards', 'Payment'),
('airtime_purchase', 'Airtime Purchase', 'Buy airtime for free across all networks', 'Payment'),
('analytics', 'Analytics', 'Transaction analytics and reports', 'Business'),
('business_tools', 'Business Tools', 'Advanced tools for businesses', 'Business'),
('feedback_dashboard', 'Feedback Management', 'Manage customer feedback', 'Admin');

-- Create a junction table to map which features are available for each tier
CREATE TABLE public.tier_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL,
  feature_id TEXT NOT NULL REFERENCES public.features(feature_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tier, feature_id)
);

-- Insert the tier-feature mappings based on current UI
INSERT INTO public.tier_features (tier, feature_id) VALUES
-- Free tier
('free', 'dashboard_access'),
('free', 'feedback_submission'),
('free', 'transfers'),
('free', 'airtime_purchase'),
-- Basic tier (includes all free features plus additional ones)
('basic', 'dashboard_access'),
('basic', 'feedback_submission'),
('basic', 'transfers'),
('basic', 'airtime_purchase'),
('basic', 'virtual_cards'),
-- Premium tier (includes all basic features plus additional ones)
('premium', 'dashboard_access'),
('premium', 'feedback_submission'),
('premium', 'transfers'),
('premium', 'airtime_purchase'),
('premium', 'virtual_cards'),
('premium', 'analytics'),
-- Enterprise tier (includes all premium features plus additional ones)
('enterprise', 'dashboard_access'),
('enterprise', 'feedback_submission'),
('enterprise', 'transfers'),
('enterprise', 'airtime_purchase'),
('enterprise', 'virtual_cards'),
('enterprise', 'analytics'),
('enterprise', 'business_tools');

-- Enable RLS on the new tables
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_features ENABLE ROW LEVEL SECURITY;

-- Create policies for features table - readable by all authenticated users
CREATE POLICY "Features are readable by all authenticated users"
ON public.features FOR SELECT
TO authenticated
USING (true);

-- Create policies for tier_features table - readable by all authenticated users
CREATE POLICY "Tier features are readable by all authenticated users"
ON public.tier_features FOR SELECT
TO authenticated
USING (true);

-- Create a function to get features for a specific tier
CREATE OR REPLACE FUNCTION public.get_tier_features(p_tier TEXT)
RETURNS TABLE (
  feature_id TEXT,
  name TEXT,
  description TEXT,
  category TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT f.feature_id, f.name, f.description, f.category
  FROM public.features f
  INNER JOIN public.tier_features tf ON f.feature_id = tf.feature_id
  WHERE tf.tier = p_tier
  ORDER BY f.category, f.name;
$$;

-- Create a function to check if a user has access to a specific feature
CREATE OR REPLACE FUNCTION public.user_has_feature_access(p_user_id UUID, p_feature_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscribers s
    INNER JOIN public.tier_features tf ON s.subscription_tier = tf.tier
    WHERE s.user_id = p_user_id
    AND tf.feature_id = p_feature_id
    AND s.subscription_status = 'active'
  );
$$;

-- Update the existing tier_limits table to ensure it has all current tiers
INSERT INTO public.tier_limits (tier, monthly_transactions, monthly_transaction_amount, virtual_cards_limit, api_calls_per_hour, features)
VALUES 
('free', 10, 1000, 1, 100, '["dashboard_access", "feedback_submission", "transfers", "airtime_purchase"]'),
('basic', 100, 10000, 3, 500, '["dashboard_access", "feedback_submission", "transfers", "airtime_purchase", "virtual_cards"]'),
('premium', 1000, 50000, 10, 2000, '["dashboard_access", "feedback_submission", "transfers", "airtime_purchase", "virtual_cards", "analytics"]'),
('enterprise', -1, -1, -1, -1, '["dashboard_access", "feedback_submission", "transfers", "airtime_purchase", "virtual_cards", "analytics", "business_tools"]')
ON CONFLICT (tier) DO UPDATE SET
  monthly_transactions = EXCLUDED.monthly_transactions,
  monthly_transaction_amount = EXCLUDED.monthly_transaction_amount,
  virtual_cards_limit = EXCLUDED.virtual_cards_limit,
  api_calls_per_hour = EXCLUDED.api_calls_per_hour,
  features = EXCLUDED.features,
  updated_at = now();
