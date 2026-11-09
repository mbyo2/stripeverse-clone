-- Platform-wide table-privilege sweep (companion to 20261255) — 2026-11-09.
--
-- 20261255 hardened merchant_accounts, api_keys, developer_invoices,
-- developer_webhooks and payment_links. This migration sweeps the REST of
-- the public schema (150 tables total), which carried the same Supabase
-- default-grant pattern: 89 tables held the full blanket set (SELECT,
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) for BOTH `anon`
-- and `authenticated`. TRUNCATE and TRIGGER bypass RLS entirely, so every
-- one of those tables was exposed to unauthenticated truncation via the
-- Data API surface regardless of its RLS policies.
--
-- Method (evidence per table, introspected live before writing):
--   * Live grant matrix from pg_class relacl + column ACLs (attacl),
--     RLS policies from pg_policies, and client access paths from
--     src/** .from('<table>') verb analysis (edge functions run as
--     service_role and were not counted as client access).
--   * `anon` keeps a grant ONLY where a public flow is proven by an
--     anon-applicable RLS policy: beta_feedback INSERT (public feedback
--     form), contact_messages INSERT (public contact form),
--     crypto_invoices SELECT (guest-checkout invoice view,
--     payment_link_code IS NOT NULL), pricing_tiers SELECT (public
--     pricing page), payment_links SELECT and p2p_ads SELECT (already
--     correct, untouched). Everywhere else anon is revoked in full.
--   * `authenticated` is normalised per table to the verbs the client
--     genuinely uses (src verbs + applicable RLS policy commands).
--     TRUNCATE, TRIGGER and REFERENCES are stripped everywhere. Tables
--     only ever read by their owners drop to SELECT; server-internal
--     tables (webhook_idempotency_keys) drop to service_role only.
--   * Column-level grants (attacl) are deliberate narrow surfaces on
--     escrow_transactions, payment_requests, refunds, savings_accounts,
--     two_factor_auth and virtual_cards (e.g. authenticated UPDATE on
--     payment_requests.paid_at/status only). Those tables get targeted
--     table-level revokes only — no table-level privilege is ADDED where
--     a column grant already carries the flow, and the column grants
--     themselves are untouched. identity_verifications and
--     payment_links are likewise already correct and untouched.
--   * The single grant ADDED by this migration: anon SELECT on
--     pricing_tiers. The "Public can view active pricing tiers" policy
--     has existed, but anon held every privilege EXCEPT SELECT, so the
--     public pricing read was grant-blocked. This aligns the grant with
--     the existing policy (same class of fix as merchant_accounts in
--     20261255).
--   * service_role is untouched everywhere. All grants on these tables
--     were granted by `postgres`, so the revokes are effective (verified
--     live after applying by re-reading the privilege catalogues and
--     has_table_privilege).
--
-- All 150 public tables have RLS enabled; the 25 policy-less tables are
-- service_role-only already and need no change.


-- ---------------------------------------------------------------------------
-- anon: revoke in full everywhere no public flow is proven.
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.accounts, public.agent_locations, public.aml_screenings, public.api_ip_whitelist, public.audit_logs, public.bank_accounts FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.bill_payments, public.billing_retry_queue, public.bnpl_plans, public.btc_address_assignments, public.btc_deposit_addresses, public.btc_deposits FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.btc_onchain_deposits, public.btc_quotes, public.btc_selfcustody_sell_intents, public.btc_settings, public.btc_withdrawals, public.budget_goals FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.bulk_payment_items, public.bulk_payments, public.card_tokens, public.compliance_checks, public.crypto_account_wallets, public.crypto_address_nonces FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.crypto_payout_requests, public.crypto_treasury_config, public.crypto_wallets, public.currency_conversions, public.developer_webhook_deliveries, public.dispute_messages FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.escrow_transactions, public.exchange_rates, public.features, public.fraud_rules, public.invoices, public.kyc_verifications FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.lightning_payments, public.marketplace_transactions, public.mastercard_move_payments, public.merchant_fee_schedules, public.merchant_invoices, public.merchant_kyb_applications FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.merchant_payment_plans, public.mobile_money_payments, public.moonpay_transactions, public.newsletter_subscriptions, public.notification_preferences, public.notifications FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.p2p_account_transfers, public.p2p_wallets, public.payment_methods, public.payment_requests, public.payoneer_payouts, public.payout_batches FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.payouts, public.paypal_provenance_balances, public.paypal_withdrawals, public.plan_installment_payments, public.platform_settings, public.profiles FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.provider_intents, public.rate_limits, public.receiving_accounts, public.receiving_deposits, public.receiving_partners, public.refunds FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.reward_transactions, public.role_audit, public.role_requests, public.saved_contacts, public.savings_accounts, public.scheduled_payments FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.security_events, public.settlement_reports, public.spending_budgets, public.split_rules, public.subaccounts, public.subscribers FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.subscription_invoices, public.subscription_usage, public.subscriptions, public.tier_features, public.tier_limits, public.transaction_categories FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.transaction_disputes, public.two_factor_auth, public.used_totp_tokens, public.user_rewards, public.user_roles, public.user_sessions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.vendor_crypto_wallets, public.virtual_cards, public.wallet_reconciliations, public.wallets, public.webhook_delivery_logs, public.webhook_idempotency_keys FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.webhooks FROM anon;

-- anon: the proven public flows keep exactly one privilege each.
REVOKE ALL PRIVILEGES ON TABLE public.beta_feedback FROM anon;
GRANT INSERT ON TABLE public.beta_feedback TO anon;
REVOKE ALL PRIVILEGES ON TABLE public.contact_messages FROM anon;
GRANT INSERT ON TABLE public.contact_messages TO anon;
REVOKE ALL PRIVILEGES ON TABLE public.crypto_invoices FROM anon;
GRANT SELECT ON TABLE public.crypto_invoices TO anon;
REVOKE ALL PRIVILEGES ON TABLE public.pricing_tiers FROM anon;
GRANT SELECT ON TABLE public.pricing_tiers TO anon;

-- ---------------------------------------------------------------------------
-- authenticated: strip everything, re-grant exactly the evidenced verbs.
-- (Grouped by identical target set.)
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.webhook_idempotency_keys FROM authenticated;
-- (no re-grant: webhook_idempotency_keys is service_role-only from the client side)
REVOKE ALL PRIVILEGES ON TABLE public.agent_locations, public.billing_retry_queue, public.btc_address_assignments, public.btc_deposit_addresses, public.btc_deposits, public.btc_onchain_deposits FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.btc_quotes, public.btc_selfcustody_sell_intents, public.crypto_account_wallets, public.crypto_invoices, public.crypto_wallets, public.developer_webhook_deliveries FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.features, public.invoices, public.lightning_payments, public.mastercard_move_payments, public.mobile_money_payments, public.moonpay_transactions FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.p2p_account_transfers, public.p2p_payment_methods, public.p2p_reviews, public.p2p_trader_profiles, public.p2p_wallets, public.payoneer_payouts FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.paypal_provenance_balances, public.paypal_withdrawals, public.platform_settings, public.provider_intents, public.rate_limits, public.receiving_accounts FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.receiving_deposits, public.receiving_partners, public.settlement_reports, public.subscription_invoices, public.subscription_usage, public.tier_features FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tier_limits, public.user_sanctions, public.webhook_delivery_logs FROM authenticated;
GRANT SELECT ON TABLE public.agent_locations, public.billing_retry_queue, public.btc_address_assignments, public.btc_deposit_addresses, public.btc_deposits, public.btc_onchain_deposits TO authenticated;
GRANT SELECT ON TABLE public.btc_quotes, public.btc_selfcustody_sell_intents, public.crypto_account_wallets, public.crypto_invoices, public.crypto_wallets, public.developer_webhook_deliveries TO authenticated;
GRANT SELECT ON TABLE public.features, public.invoices, public.lightning_payments, public.mastercard_move_payments, public.mobile_money_payments, public.moonpay_transactions TO authenticated;
GRANT SELECT ON TABLE public.p2p_account_transfers, public.p2p_payment_methods, public.p2p_reviews, public.p2p_trader_profiles, public.p2p_wallets, public.payoneer_payouts TO authenticated;
GRANT SELECT ON TABLE public.paypal_provenance_balances, public.paypal_withdrawals, public.platform_settings, public.provider_intents, public.rate_limits, public.receiving_accounts TO authenticated;
GRANT SELECT ON TABLE public.receiving_deposits, public.receiving_partners, public.settlement_reports, public.subscription_invoices, public.subscription_usage, public.tier_features TO authenticated;
GRANT SELECT ON TABLE public.tier_limits, public.user_sanctions, public.webhook_delivery_logs TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.beta_feedback, public.crypto_address_nonces, public.used_totp_tokens, public.wallet_reconciliations, public.wallets FROM authenticated;
GRANT INSERT, SELECT ON TABLE public.beta_feedback, public.crypto_address_nonces, public.used_totp_tokens, public.wallet_reconciliations, public.wallets TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.notifications FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.btc_withdrawals, public.contact_messages, public.crypto_payout_requests, public.kyc_verifications, public.merchant_kyb_applications, public.newsletter_subscriptions FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.notification_preferences, public.payout_batches, public.profiles, public.role_requests FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.btc_withdrawals, public.contact_messages, public.crypto_payout_requests, public.kyc_verifications, public.merchant_kyb_applications, public.newsletter_subscriptions TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.notification_preferences, public.payout_batches, public.profiles, public.role_requests TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.accounts, public.aml_screenings, public.api_ip_whitelist, public.audit_logs, public.bank_accounts, public.bnpl_plans FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.btc_settings, public.budget_goals, public.bulk_payment_items, public.bulk_payments, public.card_tokens, public.compliance_checks FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.crypto_treasury_config, public.dispute_messages, public.exchange_rates, public.fraud_rules, public.marketplace_transactions, public.merchant_fee_schedules FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.merchant_invoices, public.merchant_payment_plans, public.payment_methods, public.payouts, public.plan_installment_payments, public.pricing_tiers FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.reward_transactions, public.role_audit, public.saved_contacts, public.scheduled_payments, public.security_events, public.spending_budgets FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.split_rules, public.subscribers, public.subscriptions, public.transaction_categories, public.transaction_disputes, public.user_rewards FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.user_roles, public.user_sessions, public.vendor_crypto_wallets, public.webhooks FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.accounts, public.aml_screenings, public.api_ip_whitelist, public.audit_logs, public.bank_accounts, public.bnpl_plans TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.btc_settings, public.budget_goals, public.bulk_payment_items, public.bulk_payments, public.card_tokens, public.compliance_checks TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.crypto_treasury_config, public.dispute_messages, public.exchange_rates, public.fraud_rules, public.marketplace_transactions, public.merchant_fee_schedules TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.merchant_invoices, public.merchant_payment_plans, public.payment_methods, public.payouts, public.plan_installment_payments, public.pricing_tiers TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.reward_transactions, public.role_audit, public.saved_contacts, public.scheduled_payments, public.security_events, public.spending_budgets TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.split_rules, public.subscribers, public.subscriptions, public.transaction_categories, public.transaction_disputes, public.user_rewards TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.user_roles, public.user_sessions, public.vendor_crypto_wallets, public.webhooks TO authenticated;

-- ---------------------------------------------------------------------------
-- authenticated: targeted revokes on tables with deliberate column-level
-- grant surfaces (column grants untouched; see header).
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.bill_payments FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.currency_conversions FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.escrow_transactions FROM authenticated;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.payment_requests FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.refunds FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.savings_accounts FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.subaccounts FROM authenticated;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.two_factor_auth FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.virtual_cards FROM authenticated;
