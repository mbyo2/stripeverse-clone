-- Currency integrity (CEO order 2026-11-11: "make sure currencies
-- don't mix" + "currency switcher should work flawless").
--
-- Three aggregate RPCs summed public.transactions.amount across ALL
-- currencies with no currency filter, so a user holding both a ZMW
-- and a USD fee row got one blended figure (the platform owner's
-- October dashboard bar read 8.46 = K8.33 of ZMW fees + a $0.13 USD
-- fee, added together as if they were the same money). The analytics
-- summary RPC (20261114) already scopes its revenue/sent figures to
-- ZMW — the platform's home currency, and the currency of the Main
-- wallet the dashboard banner reports. These three now match it:
--
--   get_user_transaction_stats.monthly_amount  -> ZMW rows only
--   get_monthly_transaction_data.amount        -> ZMW rows only
--   get_spending_by_category.amount            -> ZMW rows only
--
-- Counts (total_transactions, monthly_transactions, transaction_count)
-- are currency-neutral and unchanged. Signatures, return types and
-- grants are unchanged (CREATE OR REPLACE preserves the ACL). No
-- balance or ledger row is touched — this only stops the aggregates
-- from adding different currencies together.

CREATE OR REPLACE FUNCTION public.get_user_transaction_stats(p_user_id uuid)
 RETURNS TABLE(total_transactions integer, monthly_amount numeric, monthly_transactions integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*)::INTEGER as total_transactions,
    COALESCE(SUM(CASE
      WHEN created_at >= date_trunc('month', now()) AND currency = 'ZMW'
      THEN amount
      ELSE 0
    END), 0) as monthly_amount,
    COUNT(CASE
      WHEN created_at >= date_trunc('month', now())
      THEN 1
    END)::INTEGER as monthly_transactions
  FROM public.transactions
  WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_monthly_transaction_data(p_user_id uuid)
 RETURNS TABLE(month text, amount numeric, transaction_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    to_char(date_trunc('month', created_at), 'Mon') as month,
    COALESCE(SUM(amount), 0) as amount,
    COUNT(*)::INTEGER as transaction_count
  FROM public.transactions
  WHERE user_id = p_user_id
    AND currency = 'ZMW'
    AND created_at >= now() - interval '6 months'
  GROUP BY date_trunc('month', created_at)
  ORDER BY date_trunc('month', created_at);
$function$;

CREATE OR REPLACE FUNCTION public.get_spending_by_category(p_user_id uuid)
 RETURNS TABLE(category text, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(t.category, 'Other') as category,
    SUM(t.amount) as amount
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.direction = 'outgoing'
    AND t.currency = 'ZMW'
    AND t.created_at >= date_trunc('month', now())
  GROUP BY t.category
  ORDER BY amount DESC
  LIMIT 5;
$function$;
