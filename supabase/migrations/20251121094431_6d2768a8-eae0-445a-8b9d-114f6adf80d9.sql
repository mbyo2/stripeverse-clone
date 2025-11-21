-- Add webhook_secret column to webhooks table
ALTER TABLE public.webhooks 
ADD COLUMN webhook_secret TEXT DEFAULT encode(gen_random_bytes(32), 'base64');

-- Generate secrets for existing webhooks that don't have one
UPDATE public.webhooks 
SET webhook_secret = encode(gen_random_bytes(32), 'base64')
WHERE webhook_secret IS NULL;

-- Make webhook_secret NOT NULL after populating
ALTER TABLE public.webhooks 
ALTER COLUMN webhook_secret SET NOT NULL;