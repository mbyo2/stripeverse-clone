-- find_transfer_recipient: canonicalize ZAMBIAN phone numbers on BOTH
-- sides of the match.
--
-- Problem this fixes (live QA, 2026-10-22): the original function did
-- digits-only equality on the full digit strings. profiles.phone is
-- free text (users type it in Settings), so a recipient's number is
-- commonly stored as "+260 97 000 0000" (digits 260970000000), while
-- senders naturally type the local format "0970000000" (digits
-- 0970000000). Those digit strings are never equal, so /transfer and
-- /send-money refused with "No account found" for a recipient who
-- exists. The exact stored format worked; every other format of the
-- same number failed.
--
-- Fix: both the query and the stored phone are canonicalized to the
-- Zambian digit form 260 + 9-digit subscriber number before comparing:
--   260XXXXXXXXX (12 digits)  -> unchanged
--   0XXXXXXXXX   (10 digits)  -> 260 || subscriber
--   XXXXXXXXX    (9 digits, starting 7 or 9) -> 260 || digits
-- A row matches when the canonical forms are equal. The original
-- exact digits-only equality is kept as a fallback so non-Zambian
-- numbers stored verbatim still match when typed verbatim.
--
-- Security properties are unchanged: SECURITY DEFINER, exact match
-- only (a full number in some format — canonicalization does not widen
-- the match beyond format variants of the same complete number), at
-- most one row, returns only user id + display name. No enumeration.
-- The client-side twin of this rule lives in src/utils/phoneNumber.ts;
-- keep the two in sync.

CREATE OR REPLACE FUNCTION public.find_transfer_recipient(p_query text)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_query text := btrim(coalesce(p_query, ''));
  v_digits text;
  v_canon text;
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

  -- Phone path.
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  IF length(v_digits) < 7 THEN
    RETURN;
  END IF;

  -- Canonical Zambian form of the query (NULL when not Zambian-shaped).
  v_canon :=
    CASE
      WHEN v_digits ~ '^260\d{9}$' THEN v_digits
      WHEN v_digits ~ '^0\d{9}$' THEN '260' || substr(v_digits, 2)
      WHEN v_digits ~ '^[79]\d{8}$' THEN '260' || v_digits
      ELSE NULL
    END;

  RETURN QUERY
  SELECT p.id,
         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  FROM public.profiles p
  WHERE regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_digits
     OR (
       v_canon IS NOT NULL
       AND (
         CASE
           WHEN regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') ~ '^260\d{9}$'
             THEN regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
           WHEN regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') ~ '^0\d{9}$'
             THEN '260' || substr(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 2)
           WHEN regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') ~ '^[79]\d{8}$'
             THEN '260' || regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
           ELSE NULL
         END
       ) = v_canon
     )
  LIMIT 1;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.find_transfer_recipient(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_transfer_recipient(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_transfer_recipient(text) TO authenticated;
