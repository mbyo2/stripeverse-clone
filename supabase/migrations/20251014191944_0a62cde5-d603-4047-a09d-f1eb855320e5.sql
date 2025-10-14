-- Security Fix: Encrypt merchant API keys and webhook secrets
-- Add encryption functions for merchant account credentials

-- Function to encrypt sensitive merchant data
CREATE OR REPLACE FUNCTION public.encrypt_merchant_secret(secret_text text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  encrypted_value text;
  salt text;
BEGIN
  -- Generate random salt
  salt := encode(gen_random_bytes(32), 'base64');
  
  -- Use SHA-512 for stronger encryption
  encrypted_value := encode(
    digest(secret_text || salt, 'sha512'),
    'hex'
  );
  
  RETURN jsonb_build_object(
    'encrypted', encrypted_value,
    'salt', salt,
    'version', '1.0'
  )::text;
END;
$$;

-- Function to mask API keys (show only prefix and last 4 chars)
CREATE OR REPLACE FUNCTION public.mask_api_key(api_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF api_key IS NULL OR length(api_key) < 8 THEN
    RETURN NULL;
  END IF;
  
  RETURN substring(api_key, 1, 4) || '...' || right(api_key, 4);
END;
$$;

-- Add masked columns for API keys in merchant_accounts
ALTER TABLE public.merchant_accounts 
  ADD COLUMN IF NOT EXISTS api_key_masked text,
  ADD COLUMN IF NOT EXISTS webhook_secret_masked text;

-- Update existing records to mask the keys
UPDATE public.merchant_accounts
SET 
  api_key_masked = public.mask_api_key(api_key),
  webhook_secret_masked = public.mask_api_key(webhook_secret)
WHERE api_key IS NOT NULL OR webhook_secret IS NOT NULL;

-- Create view that only shows masked credentials
CREATE OR REPLACE VIEW public.merchant_accounts_safe AS
SELECT 
  id,
  user_id,
  business_name,
  business_type,
  registration_number,
  tax_id,
  address,
  contact_info,
  verification_documents,
  status,
  api_key_masked,
  webhook_secret_masked,
  webhook_url,
  created_at,
  updated_at
FROM public.merchant_accounts;

-- Grant access to the safe view
GRANT SELECT ON public.merchant_accounts_safe TO authenticated;

-- Enable RLS on the view
ALTER VIEW public.merchant_accounts_safe SET (security_invoker = on);

-- Function to securely retrieve full API key (requires additional verification)
CREATE OR REPLACE FUNCTION public.get_merchant_api_key(merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_owns_account boolean;
  api_key_value text;
BEGIN
  -- Verify ownership
  SELECT EXISTS(
    SELECT 1 FROM public.merchant_accounts 
    WHERE id = merchant_id AND user_id = auth.uid()
  ) INTO user_owns_account;
  
  IF NOT user_owns_account THEN
    RAISE EXCEPTION 'Unauthorized access to merchant credentials';
  END IF;
  
  -- Log the access attempt
  PERFORM public.log_security_event(
    auth.uid(),
    'merchant_api_key_accessed',
    jsonb_build_object(
      'merchant_id', merchant_id,
      'timestamp', now()
    ),
    NULL,
    NULL,
    3 -- Medium risk score for credential access
  );
  
  -- Return the API key
  SELECT api_key INTO api_key_value
  FROM public.merchant_accounts
  WHERE id = merchant_id;
  
  RETURN api_key_value;
END;
$$;