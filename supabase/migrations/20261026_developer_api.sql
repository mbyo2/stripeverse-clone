-- Developer API (Workstream A, CEO order 2026-10-26): unified public API
-- authenticated by the existing public.api_keys table (SHA-256 hashes,
-- bmp_test_ / bmp_live_ prefixes, full key shown once at creation).
--
-- Honest test mode: there is NO test-mode ledger in this app and no
-- transaction row is ever marked as test data. Test keys are therefore
-- READ-ONLY (enforced in the developer-api edge function) plus webhook
-- registration/test delivery. This migration only adds the bookkeeping
-- the developer API needs:
--   1. api_keys.mode — explicit 'test' | 'live', backfilled from prefix.
--   2. developer_webhooks — developer-owned webhook endpoints. The secret
--      is stored so the service role can sign deliveries; it is shown to
--      the owner exactly once (at creation, by the API) and the RLS policy
--      below never exposes the secret column to other users. (Same storage
--      pattern as the pre-existing public.webhooks.secret.)
--   3. developer_webhook_deliveries — the delivery log: one row per
--      delivery attempt, written ONLY by the service role. Owners can read
--      their own log; nobody can write it from the client.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'test';

UPDATE public.api_keys
SET mode = CASE WHEN key_prefix LIKE '%live%' THEN 'live' ELSE 'test' END
WHERE mode IS NULL OR mode = 'test';

ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_mode_check;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_mode_check CHECK (mode IN ('test', 'live'));

CREATE TABLE IF NOT EXISTS public.developer_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_developer_webhooks_user ON public.developer_webhooks(user_id);
ALTER TABLE public.developer_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own developer webhooks" ON public.developer_webhooks;
CREATE POLICY "Users manage own developer webhooks"
ON public.developer_webhooks FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.developer_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES public.developer_webhooks(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dev_wh_deliveries_user ON public.developer_webhook_deliveries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_wh_deliveries_webhook ON public.developer_webhook_deliveries(webhook_id);
ALTER TABLE public.developer_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own developer webhook deliveries" ON public.developer_webhook_deliveries;
CREATE POLICY "Users view own developer webhook deliveries"
ON public.developer_webhook_deliveries FOR SELECT TO authenticated
USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policy: only the service role (which bypasses
-- RLS) writes the delivery log.
