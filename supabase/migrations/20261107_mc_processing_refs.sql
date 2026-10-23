-- Mastercard Processing provider references on virtual_cards.
--
-- The Processing Core integration (gateway brief §1.1) creates three
-- CMS objects per issued card — a Client, an Account Contract and a
-- Card Contract — and the platform needs their provider ids on the
-- card record to call card status / transactions later and to reuse
-- a cardholder's CMS client for their next card instead of minting
-- a duplicate (the CMS refuses a second client with the same
-- clientNumber: DUPLICATED_CLIENT_NUMBER).
--
-- Live public.virtual_cards (verified via information_schema,
-- 2026-10-23; see 20261026_virtual_cards_cvv_hygiene.sql) has
-- EXACTLY 18 columns and none of them reference the provider — the
-- `provider` TEXT column only names the network ('mastercard').
-- This migration adds the three reference columns. All nullable:
-- locally issued cards (the pre-Processing admin flow) have no CMS
-- objects, and their rows stay valid untouched. TEXT because CMS
-- ids are stored normalised as strings (see
-- _shared/mastercard-processing.ts).
--
-- RLS is UNCHANGED: no policy statements here — the existing
-- "Users manage own virtual cards" policy governs the new columns
-- like every other column on the row.
--
-- Idempotent: safe to apply on live and on a fresh rebuild (after
-- 20261017 / 20261026).

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS provider_client_id TEXT;

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT;

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS provider_card_id TEXT;

CREATE INDEX IF NOT EXISTS idx_virtual_cards_provider_card_id
  ON public.virtual_cards (provider_card_id)
  WHERE provider_card_id IS NOT NULL;
