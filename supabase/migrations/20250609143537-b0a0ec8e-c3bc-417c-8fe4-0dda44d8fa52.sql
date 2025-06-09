
-- Update tier limits to remove free transactions
UPDATE public.tier_limits SET 
  monthly_transactions = 0,
  features = '["dashboard_access", "feedback_submission", "transfers"]'
WHERE tier = 'free';

UPDATE public.tier_limits SET 
  monthly_transactions = 0,
  features = '["dashboard_access", "feedback_submission", "virtual_cards", "transfers"]'
WHERE tier = 'basic';

UPDATE public.tier_limits SET 
  monthly_transactions = 0,
  features = '["dashboard_access", "feedback_submission", "virtual_cards", "transfers", "analytics"]'
WHERE tier = 'premium';

UPDATE public.tier_limits SET 
  monthly_transactions = 0,
  features = '["dashboard_access", "feedback_submission", "virtual_cards", "transfers", "analytics", "business_tools"]'
WHERE tier = 'enterprise';
