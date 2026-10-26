-- 20261228 — PayPal billing plans gain a billing-period dimension
-- (subscription-billing migration: Stripe → PayPal, CEO decision
-- 2026-10-26 18:03).
--
-- Until now paypal_billing_plans keyed a price point as
-- (tier, currency, amount) and paypal-checkout always minted plans
-- with a MONTH frequency — so a yearly checkout would have created
-- a plan that bills the YEARLY amount every MONTH. The catalogue now
-- carries interval_unit ('MONTH' | 'YEAR') as part of the price-point
-- key, and paypal-checkout passes the buyer's chosen period through.
-- Existing rows were all minted with MONTH frequency, which is what
-- the new default records — no row changes meaning.
--
-- This migration does NOT touch reserve_paypal_withdrawal /
-- refund_paypal_withdrawal: their 20261213 float bodies remain the
-- only correct base for those two functions.

alter table public.paypal_billing_plans
  add column if not exists interval_unit text not null default 'MONTH';

alter table public.paypal_billing_plans
  drop constraint if exists paypal_billing_plans_interval_unit_check;

alter table public.paypal_billing_plans
  add constraint paypal_billing_plans_interval_unit_check
  check (interval_unit in ('MONTH', 'YEAR'));

alter table public.paypal_billing_plans
  drop constraint if exists paypal_billing_plans_tier_currency_amount_key;

create unique index if not exists paypal_billing_plans_price_point_key
  on public.paypal_billing_plans (tier, currency, amount, interval_unit);
