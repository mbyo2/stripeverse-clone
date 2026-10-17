-- Allow anonymous visitors to read active pricing tiers.
-- The public landing page shows pricing to logged-out visitors;
-- without this, usePricing() hangs on "Loading Pricing..." forever.

DROP POLICY IF EXISTS "Public can view active pricing tiers" ON public.pricing_tiers;
CREATE POLICY "Public can view active pricing tiers"
ON public.pricing_tiers FOR SELECT TO anon
USING (is_active = true);
