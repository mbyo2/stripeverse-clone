-- =====================================================================
-- 20261104_superadmin_roles_enum.sql — Superadmin foundation, part 1
-- of 2: the app_role enum values ONLY.
--
-- WHY A SEPARATE FILE / SEPARATE RUNS: ALTER TYPE ... ADD VALUE cannot
-- be USED inside the same transaction that adds it (Postgres raises
-- 55P04 "unsafe use of new value" if a later statement in the same
-- transaction references the new label). The dashboard SQL editor wraps
-- each Run in its own transaction, so:
--
--   RELAY ORDER: run EACH statement below as its OWN Run, in order,
--   and only then run 20261105_superadmin_foundation.sql.
--
-- Values added:
--   super_admin       — the platform owner tier (sole initial holder:
--                       the CEO's account, granted in part 2).
--   p2p_admin         — per-feature admin: P2P marketplace console.
--   support_admin     — per-feature admin: support (foundation only).
--   compliance_admin  — per-feature admin: compliance (foundation).
--   finance_admin     — per-feature admin: finance (foundation only).
--
-- ADD VALUE IF NOT EXISTS keeps every statement idempotent, matching
-- the 20250922130725 'moderator' precedent.
-- =====================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'p2p_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'support_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'compliance_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance_admin';
