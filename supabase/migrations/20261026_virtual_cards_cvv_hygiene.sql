-- Virtual cards: reconcile the repo schema with the LIVE table and
-- finish the CVV hygiene (audit finding, 2026-10-22; live schema
-- verified via information_schema on project paymentgetway,
-- 2026-10-23).
--
-- VERIFIED LIVE SCHEMA — public.virtual_cards has EXACTLY 18 columns:
--   id uuid NOT NULL, user_id uuid NOT NULL, wallet_id uuid NOT NULL
--   (FK -> wallets), name text NOT NULL, masked_number text NOT NULL,
--   expiry_date DATE NOT NULL, balance numeric NOT NULL,
--   currency text NOT NULL, status text NOT NULL,
--   provider text NOT NULL, card_type text NOT NULL,
--   daily_limit numeric NULL, monthly_limit numeric NULL,
--   transaction_limit numeric NULL, online_transactions boolean NULL,
--   international_transactions boolean NULL,
--   created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL.
--
-- DRIFT: the repo migration 20261017_virtual_cards_schema.sql was
-- written from the Lovable-era design and does NOT match the live
-- table — it declares card_number TEXT NOT NULL and cvv TEXT NOT NULL
-- columns that DO NOT EXIST live, types expiry_date as TEXT, and has
-- no wallet_id. The live table was evidently hand-adjusted after
-- creation. Because the secret columns never existed live, no stored
-- CVVs or full card numbers exist to purge: the create-virtual-card
-- hygiene fix (reveal once in the creation response, never store)
-- is complete by construction.
--
-- WHAT THIS MIGRATION DOES (all idempotent):
--   1. Drops the repo-only secret columns. Against the LIVE database
--      both DROPs are no-ops (the columns are already absent). On a
--      fresh rebuild from repo migrations, 20261017 creates them and
--      this migration removes them, converging to the live shape.
--   2. Adds wallet_id if a fresh rebuild lacks it (20261017 has no
--      such column; live has it NOT NULL — on a rebuild it is added
--      nullable because pre-existing rows could not be backfilled
--      blindly, and create-virtual-card always writes it).
--
-- Known remaining rebuild-only difference, documented rather than
-- papered over: 20261017 types expiry_date as TEXT while live is
-- DATE. No conversion is attempted here — historical repo-era values
-- were 'MM/YY' strings with no day component, so a blind cast would
-- invent data. create-virtual-card writes ISO dates (YYYY-MM-DD),
-- which both shapes accept.
--
-- DEPLOY ORDER: this migration is a no-op on live, so ordering is
-- not load-bearing there; on a fresh rebuild it must run after
-- 20261017 and before create-virtual-card serves traffic.

ALTER TABLE public.virtual_cards DROP COLUMN IF EXISTS cvv;
ALTER TABLE public.virtual_cards DROP COLUMN IF EXISTS card_number;

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES public.wallets(id);
