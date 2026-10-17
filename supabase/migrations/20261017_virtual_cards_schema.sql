-- Virtual cards schema backfill.
-- The virtual_cards table and its helper RPCs were created live via Lovable
-- and never captured in a repo migration. This migration makes the repo the
-- source of truth. All statements are idempotent (safe to apply on live).

CREATE TABLE IF NOT EXISTS public.virtual_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  card_number TEXT NOT NULL,
  masked_number TEXT NOT NULL,
  cvv TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'cancelled')),
  provider TEXT NOT NULL DEFAULT 'mastercard',
  card_type TEXT NOT NULL DEFAULT 'debit',
  daily_limit NUMERIC DEFAULT 5000,
  monthly_limit NUMERIC DEFAULT 50000,
  transaction_limit NUMERIC DEFAULT 2000,
  online_transactions BOOLEAN NOT NULL DEFAULT true,
  international_transactions BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_cards_user_id ON public.virtual_cards(user_id);

ALTER TABLE public.virtual_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own virtual cards" ON public.virtual_cards;
CREATE POLICY "Users manage own virtual cards"
ON public.virtual_cards FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Link card funding/spending to the transactions ledger (if the table exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transactions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'virtual_card_id'
  ) THEN
    ALTER TABLE public.transactions ADD COLUMN virtual_card_id UUID REFERENCES public.virtual_cards(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Helper: generate a Luhn-valid test card number (BIN 5399 = Mastercard).
CREATE OR REPLACE FUNCTION public.generate_card_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits TEXT := '5399';
  i INT;
  d INT;
  sum INT := 0;
  check_digit INT;
BEGIN
  FOR i IN 1..11 LOOP
    digits := digits || floor(random() * 10)::int::text;
  END LOOP;
  -- Luhn check digit: in the final 16-digit number, every second digit from
  -- the right (positions 2,4,...,16) is doubled. The 15-digit partial's
  -- rightmost digit lands at position 2, so double odd positions here.
  FOR i IN 1..15 LOOP
    d := substring(digits, 16 - i, 1)::int;
    IF i % 2 = 1 THEN
      d := d * 2;
      IF d > 9 THEN d := d - 9; END IF;
    END IF;
    sum := sum + d;
  END LOOP;
  check_digit := (10 - (sum % 10)) % 10;
  RETURN digits || check_digit::text;
END;
$$;

-- Helper: mask a card number, keeping the last 4 digits.
CREATE OR REPLACE FUNCTION public.mask_card_number(card_number TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '**** **** **** ' || right(regexp_replace(card_number, '\s', '', 'g'), 4);
$$;
