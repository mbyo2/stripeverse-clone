-- Add INSERT policy for wallets table
CREATE POLICY "Users can insert their own wallets"
  ON public.wallets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);