
-- Create the two_factor_auth table
CREATE TABLE IF NOT EXISTS public.two_factor_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  secret TEXT,
  backup_codes JSONB,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add RLS policies for secure access
ALTER TABLE public.two_factor_auth ENABLE ROW LEVEL SECURITY;

-- Users can only read their own 2FA settings
CREATE POLICY "Users can read their own 2FA settings" 
  ON public.two_factor_auth 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can update their own 2FA settings
CREATE POLICY "Users can update their own 2FA settings" 
  ON public.two_factor_auth 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- Only the user can insert their 2FA settings
CREATE POLICY "Users can insert their own 2FA settings" 
  ON public.two_factor_auth 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- No deletion allowed through API (only cascade from user deletion)
