-- MTN MoMo direct rail: platform_settings kill switch.
--
-- The MTN MoMo skeleton (_shared/mtn-momo.ts / mtn-momo-server.ts)
-- gated ONLY on secret presence — there was no way to switch the
-- rail off without unsetting secrets (close-out audit 2026-10-27,
-- pack §B2). This adds the missing switch in the style of
-- moonpay_enabled (20261212) / p2p_enabled:
--
--   platform_settings.mtn_momo_enabled — default FALSE.
--
-- Semantics (enforced in _shared/mtn-momo.ts mtnMomoRailGate and
-- consulted by the mobile-money edge function for MTN actions):
--   - Secrets absent  → `not_configured` (unchanged answer, flag
--     state is irrelevant — the rail is not connected yet).
--   - Secrets present + flag OFF → truthful `disabled` refusal.
--   - Secrets present + flag ON  → the secret-presence logic decides
--     (existing behaviour); never a simulated success.
--
-- Flipping this flag on does NOT by itself make mobile money live:
-- the ledger integration (pack §B5) is still required for any money
-- movement.

-- ── Kill switch ──────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS mtn_momo_enabled boolean NOT NULL DEFAULT false;
