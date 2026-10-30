-- 20261247: sign-up no longer collects a phone number (CEO
-- directive, 2026-10-30: "Remove phone number for the sign up in
-- bmaglasspay.online and just leave it for KYC").
--
-- Before: the register form required a phone number and passed it
-- in the auth sign-up metadata; handle_new_user copied it into
-- profiles.phone, defaulting to '' (empty string) when absent.
--
-- After: the app sends no phone in sign-up metadata at all. The
-- phone number is collected during identity verification (KYC)
-- and written to profiles.phone by the mobile-money edge
-- function's verifyKyc at that point.
--
-- This migration keeps handle_new_user's body identical to the
-- live definition except for the phone expressions: an absent or
-- empty metadata phone now stores NULL ("no phone yet") instead
-- of ''. NULL is the honest state — every phone consumer already
-- treats NULL as "no number" (admin lists render "—",
-- find_transfer_recipient coalesces before comparing digits, the
-- P2P phone-change review trigger compares IS DISTINCT FROM),
-- while '' risked being mistaken for a real shared value by any
-- equality match.
--
-- Existing rows are NOT touched: users who signed up with a phone
-- keep it exactly as stored. CREATE OR REPLACE preserves the
-- function's existing ACL (EXECUTE revoked from PUBLIC /
-- authenticated / anon by 20260505153354). No tables are created,
-- so the 2026-10-30 scoped-GRANT rule is not triggered.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(NEW.raw_user_meta_data->>'first_name', profiles.first_name),
    last_name = COALESCE(NEW.raw_user_meta_data->>'last_name', profiles.last_name),
    phone = COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), profiles.phone),
    updated_at = NOW();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;
