-- find_transfer_recipient: resolve a wallet-transfer recipient by an
-- EXACT email or phone match, without exposing the profiles table.
--
-- Problem this fixes: SendMoney resolved the recipient by selecting
-- from public.profiles in the browser. profiles RLS only lets a user
-- read their OWN profile (plus an admin policy), so the lookup could
-- never see any other user and every wallet send failed with
-- "Recipient must have an account for wallet transfers." — even when
-- the recipient existed. Loosening profiles RLS to make the lookup
-- work would make every user's profile broadly readable, which this
-- platform must never do (profiles carry names + phone numbers).
--
-- This function is the narrow alternative: SECURITY DEFINER, exact
-- match only, at most one row, and it returns only the user id and a
-- display name. It cannot be used to enumerate or browse users — the
-- caller must already know the recipient's full email address or full
-- phone number, which is precisely what a sender types in.
--
-- Matching rules (per spec):
--   - Query containing '@': exact match on lower(auth.users.email).
--     (Email lives in auth.users; profiles has no email column.)
--   - Otherwise: digits-only equality — non-digits are stripped from
--     BOTH the query and the stored profiles.phone, and the digit
--     strings must be identical. Queries with fewer than 7 digits
--     never match (too little to identify anyone).
--
-- Display name comes from profiles (first_name + last_name) and may be
-- NULL when the user has not set a name.

CREATE OR REPLACE FUNCTION public.find_transfer_recipient(p_query text)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_query text := btrim(coalesce(p_query, ''));
  v_digits text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_query = '' THEN
    RETURN;
  END IF;

  -- Email path: exact, case-insensitive.
  IF position('@' IN v_query) > 0 THEN
    RETURN QUERY
    SELECT u.id,
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower(v_query)
    LIMIT 1;
    RETURN;
  END IF;

  -- Phone path: digits-only equality, both sides stripped.
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  IF length(v_digits) < 7 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id,
         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  FROM public.profiles p
  WHERE regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_digits
  LIMIT 1;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.find_transfer_recipient(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_transfer_recipient(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_transfer_recipient(text) TO authenticated;
