-- resolve_qr_recipient: resolve a scanned BMaGlass payment-QR recipient
-- by user id, without exposing the profiles table.
--
-- Problem this fixes (bug-free gate, 2026-11-14): QrPayments resolved
-- the recipient by selecting `id, full_name` from public.profiles.
-- That query could never succeed, for two independent reasons:
--   1. `profiles.full_name` does not exist live — names live in
--      `first_name` / `last_name` since sign-up stopped collecting
--      names (2026-11-12). PostgREST 400s the select.
--   2. profiles RLS only lets a user read their OWN profile (plus an
--      admin policy), so even a corrected column list returns zero
--      rows for any other user — the exact failure find_transfer_recipient
--      (20261022) already fixed for SendMoney / Transfer.
-- Net effect: a scanned QR code could never resolve its recipient, so
-- the pay panel never unlocked and QR payments to another user were
-- impossible even though scanning itself worked.
--
-- This function is the narrow alternative, mirroring
-- find_transfer_recipient: SECURITY DEFINER, exact id match only, at
-- most one row, returns only the user id and a display name. It cannot
-- be used to enumerate or browse users — the caller must already hold
-- the recipient's user id, which is precisely what a scanned QR code
-- carries. A caller may look up their own id too (self-pay is refused
-- by the page, not here).

CREATE OR REPLACE FUNCTION public.resolve_qr_recipient(p_user_id uuid)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id,
         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = p_user_id
  LIMIT 1;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_qr_recipient(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_qr_recipient(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_qr_recipient(uuid) TO authenticated;
