-- =====================================================================
-- 20261030_p2p_phase1c_gaps.sql — Phase 1c live-gap fixes (scope
-- §4.2/§4.3, §3.5/§3.6 evidence handling).
--
-- GAP 1 — the `p2p-evidence` storage bucket. The Phase 1c UI
-- (src/services/p2pService.ts) already uploads evidence files and
-- mints signed URLs against this bucket, but the bucket was never
-- created, so every upload/read failed. Paths are pinned by the UI:
--   chat/<order_id>/<ts>-<file>        trade-chat attachments
--   proof/<order_id>/<ts>-<file>       mark-paid proof (§3.5)
--   disputes/<dispute_id>/<ts>-<file>  dispute evidence (§3.6)
-- The bucket is PRIVATE (public = false): files are reachable only
-- through createSignedUrl(path, 600), which the storage API gates on
-- a SELECT policy for the caller — see the policies below.
--
-- GAP 2 — the AdminP2P dispute console needs the buyer's REGISTERED
-- payment method (type / account number / account name) to compare
-- against the payment claim (§3.6 admin review). p2p_payment_methods
-- only had the Phase 0 own-row SELECT policy; this adds an
-- admin-only SELECT policy beside it, using the same admin helper
-- every other Phase 0/1a admin policy uses:
-- public.has_role(auth.uid(), 'admin'::app_role) — user_roles-backed,
-- SECURITY DEFINER. (profiles.role is NOT used anywhere in the P2P
-- policy layer; it is unreliable in this codebase.)
--
-- NO new functions are created: has_role already exists and is
-- EXECUTE-granted to authenticated, and it is already proven inside
-- storage.objects policies in this repo (beta-feedback-screenshots).
--
-- Evidence immutability: there are deliberately NO update or delete
-- policies for this bucket for anyone — mirroring
-- p2p_order_messages, evidence can be added and read but never
-- altered or removed through the API. (service_role bypasses RLS
-- for lawful admin tooling off-API; there is no client path.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The bucket. file_size_limit / allowed_mime_types mirror the
-- Phase 1c UI: every file input uses accept="image/*,.pdf"
-- (TradeChat.tsx, TradeActions.tsx, P2PDispute.tsx) and the UI
-- enforces no size cap of its own, so the bucket carries the sane
-- platform cap: 10 MiB (screenshots and bank-statement PDFs sit far
-- below it). image/svg+xml is deliberately NOT in the list: it is a
-- script-bearing format and no phone camera or bank produces it as
-- evidence; the raster formats phones actually emit are all here.
-- ON CONFLICT converges the config if the relay re-runs this file.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'p2p-evidence',
  'p2p-evidence',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/bmp', 'image/tiff', 'image/heic', 'image/heif',
    'image/avif', 'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 2. storage.objects policies for p2p-evidence.
--
-- Participant predicate (shared by the INSERT and SELECT policies):
-- segment 1 of the path names the folder kind and segment 2 the id:
-- (storage.foldername(name))[1] is the kind, [2] is the order id
-- (chat/proof) or the dispute id (disputes). Participation is read
-- off public.p2p_orders (advertiser_id / taker_id); for the disputes
-- folder it resolves through the dispute's order. Ids are compared
-- as text so a malformed path segment can never raise a cast error
-- inside a policy — it simply matches nothing.
-- ---------------------------------------------------------------------

-- 2a. Participants can upload into their own trades/disputes.
DROP POLICY IF EXISTS "P2P evidence: participants can upload to their trades"
  ON storage.objects;
CREATE POLICY "P2P evidence: participants can upload to their trades"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'p2p-evidence'
    AND (
      (
        (storage.foldername(name))[1] IN ('chat', 'proof')
        AND EXISTS (
          SELECT 1 FROM public.p2p_orders o
           WHERE o.id::text = (storage.foldername(name))[2]
             AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())
        )
      )
      OR (
        (storage.foldername(name))[1] = 'disputes'
        AND EXISTS (
          SELECT 1 FROM public.p2p_disputes d
           JOIN public.p2p_orders o ON o.id = d.order_id
           WHERE d.id::text = (storage.foldername(name))[2]
             AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())
        )
      )
    )
  );

-- 2b. Participants can read files on their own trades/disputes
-- (this SELECT policy is what lets createSignedUrl mint a URL).
DROP POLICY IF EXISTS "P2P evidence: participants can view their trade files"
  ON storage.objects;
CREATE POLICY "P2P evidence: participants can view their trade files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'p2p-evidence'
    AND (
      (
        (storage.foldername(name))[1] IN ('chat', 'proof')
        AND EXISTS (
          SELECT 1 FROM public.p2p_orders o
           WHERE o.id::text = (storage.foldername(name))[2]
             AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())
        )
      )
      OR (
        (storage.foldername(name))[1] = 'disputes'
        AND EXISTS (
          SELECT 1 FROM public.p2p_disputes d
           JOIN public.p2p_orders o ON o.id = d.order_id
           WHERE d.id::text = (storage.foldername(name))[2]
             AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())
        )
      )
    )
  );

-- 2c. Admins can read everything in the bucket (dispute console).
DROP POLICY IF EXISTS "P2P evidence: admins can view all files"
  ON storage.objects;
CREATE POLICY "P2P evidence: admins can view all files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'p2p-evidence'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- No UPDATE policy. No DELETE policy. For anyone. Evidence is
-- immutable through the API by construction (absence of a policy is
-- a denial under RLS).

-- ---------------------------------------------------------------------
-- 3. Admin read of registered payment methods (AdminP2P console).
-- The Phase 0 policy "Users can view their own payment methods" is
-- untouched; this is an additional permissive SELECT policy, so
-- non-admins still see only their own rows. The table-level SELECT
-- grant to authenticated already exists (Phase 0), so no GRANT
-- change is needed — RLS was the only missing piece.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all P2P payment methods"
  ON public.p2p_payment_methods;
CREATE POLICY "Admins can view all P2P payment methods"
  ON public.p2p_payment_methods FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
