-- Create pricing tiers table for dynamic pricing
CREATE TABLE public.pricing_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_popular BOOLEAN NOT NULL DEFAULT false,
  transaction_fee_percentage NUMERIC NOT NULL DEFAULT 0,
  transaction_fee_fixed NUMERIC NOT NULL DEFAULT 0,
  max_transaction_amount NUMERIC,
  virtual_cards_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default pricing tiers
INSERT INTO public.pricing_tiers (tier_name, display_name, description, price, transaction_fee_percentage, transaction_fee_fixed, max_transaction_amount, virtual_cards_limit, features, is_popular, sort_order) VALUES
('free', 'Free Plan', 'Perfect for getting started with basic features', 0, 2.9, 2.50, 1000, 1, 
'["Dashboard Access", "Feedback Submission", "Money Transfers", "Free Airtime Purchase", "Local transfers only", "Community support"]'::jsonb, false, 1),

('basic', 'Basic Plan', 'For individuals who need more features', 9.99, 2.4, 2.00, 10000, 3,
'["All Free features", "Virtual Cards", "Free Airtime Purchase", "Local & some international transfers", "Email support"]'::jsonb, false, 2),

('premium', 'Premium Plan', 'For power users and small businesses', 19.99, 1.9, 1.50, 50000, 10,
'["All Basic features", "Priority Support", "Advanced Analytics", "Multi-currency support", "API Access", "Bulk transfers"]'::jsonb, true, 3),

('business', 'Business Plan', 'For established businesses with high volume', 49.99, 1.4, 1.00, -1, -1,
'["All Premium features", "Dedicated Account Manager", "Custom Integrations", "White-label solutions", "SLA guarantee", "Phone support"]'::jsonb, false, 4);

-- Enable RLS
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;

-- RLS policies for pricing_tiers (public read)
CREATE POLICY "Anyone can view active pricing tiers"
ON public.pricing_tiers FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage pricing tiers"
ON public.pricing_tiers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add triggers for updated_at
CREATE TRIGGER update_pricing_tiers_updated_at
BEFORE UPDATE ON public.pricing_tiers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();