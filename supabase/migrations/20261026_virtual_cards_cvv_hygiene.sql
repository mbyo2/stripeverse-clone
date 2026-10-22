-- CVV hygiene for virtual cards (audit finding, 2026-10-22).
--
-- create-virtual-card used to PERSIST the generated CVV in
-- public.virtual_cards.cvv (and log it). The function no longer
-- stores a CVV at all — it is revealed once, in the creation
-- response, and never written down — but the column was created
-- TEXT NOT NULL (20261017_virtual_cards_schema.sql), so the
-- insert of NULL would fail until the constraint is relaxed.
--
-- This migration:
--   1. drops the NOT NULL on virtual_cards.cvv, and
--   2. purges every CVV stored by earlier versions of the
--      function (one-way: those CVVs become unrecoverable, which
--      is the point — the details page's "show CVV" reveal will
--      render blank for those cards; their masked numbers,
--      balances and limits are untouched).
--
-- Context: these are platform-generated internal wallet-card
-- numbers, not real card-network credentials, and the feature is
-- admin-only / Coming Soon for the public. The aim is hygiene —
-- not operating a CVV store ahead of the Mastercard
-- developer-platform integration.
--
-- DEPLOY ORDER: apply this migration BEFORE redeploying
-- create-virtual-card, or new card creations will fail on the
-- NOT NULL constraint.

ALTER TABLE public.virtual_cards ALTER COLUMN cvv DROP NOT NULL;

UPDATE public.virtual_cards SET cvv = NULL WHERE cvv IS NOT NULL;
