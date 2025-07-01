
-- Fix RLS recursion issue by creating security definer functions
CREATE OR REPLACE FUNCTION public.has_role(user_id uuid, required_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = $1
    AND role = $2
  );
$$;

-- Drop existing problematic policies on user_roles
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;

-- Create new policies using the security definer function
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert their own roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Create function to get user wallet balance
CREATE OR REPLACE FUNCTION public.get_user_wallet_balance(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(balance, 0)
  FROM public.wallets
  WHERE user_id = p_user_id AND currency = 'ZMW'
  LIMIT 1;
$$;

-- Create function to get user transaction stats
CREATE OR REPLACE FUNCTION public.get_user_transaction_stats(p_user_id UUID)
RETURNS TABLE(
  total_transactions INTEGER,
  monthly_amount NUMERIC,
  monthly_transactions INTEGER
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
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
$$;

-- Create function to get monthly transaction data for charts
CREATE OR REPLACE FUNCTION public.get_monthly_transaction_data(p_user_id UUID)
RETURNS TABLE(
  month TEXT,
  amount NUMERIC,
  transaction_count INTEGER
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    to_char(date_trunc('month', created_at), 'Mon') as month,
    COALESCE(SUM(amount), 0) as amount,
    COUNT(*)::INTEGER as transaction_count
  FROM public.transactions
  WHERE user_id = p_user_id 
    AND created_at >= now() - interval '6 months'
  GROUP BY date_trunc('month', created_at)
  ORDER BY date_trunc('month', created_at);
$$;

-- Create function to get spending by category
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
    COALESCE(category, 'Other') as category,
    SUM(amount) as amount
  FROM public.transactions
  WHERE user_id = p_user_id 
    AND direction = 'outgoing'
    AND created_at >= date_trunc('month', now())
  GROUP BY category
  ORDER BY amount DESC
  LIMIT 5;
$$;

-- Create function to get recent transactions
CREATE OR REPLACE FUNCTION public.get_recent_transactions(p_user_id UUID, p_limit INTEGER DEFAULT 4)
RETURNS TABLE(
  id INTEGER,
  direction TEXT,
  recipient_name TEXT,
  amount NUMERIC,
  currency TEXT,
  created_at TIMESTAMPTZ,
  status TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
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
$$;
