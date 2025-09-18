-- Create encryption functions for virtual card data
CREATE OR REPLACE FUNCTION public.encrypt_card_data(card_number text, cvv text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  encrypted_data jsonb;
BEGIN
  -- In production, use pgcrypto or similar for real encryption
  -- This is a basic implementation for demo purposes
  encrypted_data := jsonb_build_object(
    'encrypted_number', encode(digest(card_number || 'salt_key', 'sha256'), 'hex'),
    'encrypted_cvv', encode(digest(cvv || 'salt_key', 'sha256'), 'hex'),
    'last_four', right(card_number, 4)
  );
  RETURN encrypted_data;
END;
$$;

-- Create decryption function (for authorized access only)
CREATE OR REPLACE FUNCTION public.decrypt_card_data(encrypted_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Return only safe data for display
  RETURN jsonb_build_object(
    'masked_number', '**** **** **** ' || (encrypted_data->>'last_four'),
    'last_four', encrypted_data->>'last_four'
  );
END;
$$;

-- Fix role escalation vulnerability in validate_role_change
CREATE OR REPLACE FUNCTION public.validate_role_change(p_user_id uuid, p_new_role text, p_changed_by uuid, p_reason text DEFAULT 'Role change request'::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_role TEXT;
  is_authorized BOOLEAN := false;
  requester_role TEXT;
BEGIN
  -- Get current role of target user
  SELECT role INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Get role of person making the change
  SELECT role INTO requester_role
  FROM public.user_roles
  WHERE user_id = p_changed_by
  LIMIT 1;

  -- SECURITY FIX: Strict authorization - only admins can change roles
  -- Remove self-elevation loophole completely
  IF requester_role = 'admin' AND p_changed_by != p_user_id THEN
    -- Admins can only change roles for OTHER users, not themselves
    -- This prevents self-elevation attacks
    IF p_new_role IN ('user', 'business', 'beta_tester') THEN
      is_authorized := true;
    -- Admin role changes require additional verification (manual process)
    ELSIF p_new_role = 'admin' THEN
      is_authorized := false; -- Always requires manual approval
    END IF;
  -- Users can only request role changes (never directly approved)
  ELSIF p_changed_by = p_user_id AND p_new_role IN ('business', 'beta_tester') THEN
    is_authorized := false; -- Always requires admin approval
  END IF;

  -- Enhanced security event logging with more details
  PERFORM public.log_security_event(
    p_user_id,
    'role_change_attempt',
    jsonb_build_object(
      'old_role', current_role,
      'new_role', p_new_role,
      'changed_by', p_changed_by,
      'requester_role', requester_role,
      'authorized', is_authorized,
      'reason', p_reason,
      'self_change_blocked', CASE WHEN p_changed_by = p_user_id AND p_new_role = 'admin' THEN true ELSE false END,
      'security_patch_version', '2.0'
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 9 END
  );

  -- Log the role change attempt with enhanced details
  INSERT INTO public.role_audit (
    user_id,
    old_role,
    new_role,
    changed_by,
    reason,
    approved
  ) VALUES (
    p_user_id,
    current_role,
    p_new_role,
    p_changed_by,
    p_reason || ' [Security patch applied]',
    is_authorized
  );

  -- If authorized, make the change
  IF is_authorized THEN
    -- Delete old role
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    -- Insert new role
    INSERT INTO public.user_roles (user_id, role) 
    VALUES (p_user_id, p_new_role::app_role);
    
    -- Log successful role change
    PERFORM public.log_security_event(
      p_user_id,
      'role_changed',
      jsonb_build_object(
        'from_role', current_role,
        'to_role', p_new_role,
        'changed_by', p_changed_by
      ),
      NULL,
      NULL,
      1
    );
  END IF;

  RETURN is_authorized;
END;
$$;

-- Add card data encryption trigger
CREATE OR REPLACE FUNCTION public.encrypt_virtual_card_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  encrypted_data jsonb;
BEGIN
  -- Encrypt sensitive card data before storing
  IF NEW.card_number IS NOT NULL AND NEW.cvv IS NOT NULL THEN
    encrypted_data := public.encrypt_card_data(NEW.card_number, NEW.cvv);
    
    -- Store encrypted data and clear plain text
    NEW.masked_number := '**** **** **** ' || right(NEW.card_number, 4);
    NEW.card_number := encrypted_data->>'encrypted_number';
    NEW.cvv := encrypted_data->>'encrypted_cvv';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Apply encryption trigger to virtual_cards table
DROP TRIGGER IF EXISTS encrypt_card_data_trigger ON public.virtual_cards;
CREATE TRIGGER encrypt_card_data_trigger
  BEFORE INSERT OR UPDATE ON public.virtual_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.encrypt_virtual_card_data();

-- Add security monitoring for card access
CREATE OR REPLACE FUNCTION public.log_card_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Log card data access for security monitoring
  PERFORM public.log_security_event(
    NEW.user_id,
    'virtual_card_accessed',
    jsonb_build_object(
      'card_id', NEW.id,
      'masked_number', NEW.masked_number,
      'access_type', TG_OP
    ),
    NULL,
    NULL,
    3
  );
  
  RETURN NEW;
END;
$$;

-- Apply card access logging
DROP TRIGGER IF EXISTS log_card_access_trigger ON public.virtual_cards;
CREATE TRIGGER log_card_access_trigger
  AFTER SELECT ON public.virtual_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.log_card_access();