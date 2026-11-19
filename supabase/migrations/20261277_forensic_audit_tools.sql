-- =====================================================================
-- 20261277 — Forensic audit tools (CEO order 2026-11-19 23:57:
-- "And forensic audit tools and exports").
--
-- Forensic tooling is platform GOVERNANCE: super_admin ONLY at every
-- layer, per the 2026-11-19 role split (backup/export already sit in
-- the super_admin tier). The existing admin-tier audit-log VIEWING
-- (Audit Logs page, audit-manager generate_report) is untouched —
-- this migration adds the forensic tier above it and widens nothing
-- for anyone else.
--
-- Shape (the admin_update_platform_settings / treasury pattern):
-- SECURITY DEFINER RPCs with the gate INSIDE the function —
-- has_role(auth.uid(), 'super_admin') or RAISE 42501 — so the gate
-- holds at the API layer for any JWT, provable with raw PostgREST.
--
--   forensic_events_feed()      internal normalized union over the
--                               nine live event sources. NOT granted
--                               to any API role: it can only run
--                               inside the definer RPCs below.
--   forensic_search(...)        cross-source filtered search,
--                               paginated, normalized event shape.
--   forensic_user_timeline(id)  every event touching one user
--                               (as actor or as subject), chrono-
--                               logical, one call.
--   forensic_user_evidence(id)  the per-user evidence pack as jsonb
--                               (profile, email, roles, wallets,
--                               transactions, full timeline).
--   forensic_log_export(...)    writes the export manifest (kind,
--                               format, scope, per-source counts,
--                               SHA-256 of the payload) into
--                               audit_logs BEFORE the client delivers
--                               the download — the export action is
--                               itself part of the audit trail.
--
-- Sources in the union (live inventory 2026-11-20): audit_logs,
-- role_audit, security_events, identity_audit_log, p2p_audit_log,
-- p2p_risk_events, card_access_audit, aml_screenings,
-- compliance_checks. webhook_delivery_logs /
-- developer_event_dispatches are delivery telemetry, not actor
-- events, and are deliberately excluded.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal feed: the normalized union. No gate of its own — it is
-- unreachable from the API (see REVOKEs at the end); the public RPCs
-- below gate before touching it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forensic_events_feed()
 RETURNS TABLE (
   source text,
   event_id text,
   occurred_at timestamptz,
   actor_id uuid,
   action text,
   target_id text,
   target_user_id uuid,
   summary text,
   detail jsonb
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- audit_logs: user_id is the actor whose session/trigger wrote the
  -- row; the subject user is the record id itself for profiles rows
  -- (profiles.id IS the user id), else the user_id carried inside
  -- the old/new values when present.
  SELECT
    'audit_logs'::text,
    a.id::text,
    a.created_at,
    a.user_id,
    a.action,
    a.record_id,
    CASE
      WHEN a.table_name = 'profiles'
        AND a.record_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN a.record_id::uuid
      WHEN a.new_values ->> 'user_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (a.new_values ->> 'user_id')::uuid
      WHEN a.old_values ->> 'user_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (a.old_values ->> 'user_id')::uuid
      ELSE NULL
    END,
    a.action || ' on ' || coalesce(a.table_name, '—'),
    jsonb_build_object(
      'table_name', a.table_name,
      'record_id', a.record_id,
      'old_values', a.old_values,
      'new_values', a.new_values,
      'ip_address', a.ip_address,
      'user_agent', a.user_agent
    )
  FROM public.audit_logs a

  UNION ALL

  -- role_audit: changed_by acted on user_id.
  SELECT
    'role_audit'::text,
    r.id::text,
    r.created_at,
    r.changed_by,
    'role_change'::text,
    r.user_id::text,
    r.user_id,
    'Role ' || coalesce(r.old_role, '—') || ' → ' || coalesce(r.new_role, '—'),
    jsonb_build_object(
      'old_role', r.old_role,
      'new_role', r.new_role,
      'reason', r.reason,
      'approved', r.approved
    )
  FROM public.role_audit r

  UNION ALL

  -- security_events: the user is both actor and subject.
  SELECT
    'security_events'::text,
    s.id::text,
    s.created_at,
    s.user_id,
    s.event_type,
    s.user_id::text,
    s.user_id,
    s.event_type || ' (risk ' || coalesce(s.risk_score::text, '—') || ')',
    jsonb_build_object(
      'event_data', s.event_data,
      'risk_score', s.risk_score,
      'ip_address', s.ip_address,
      'user_agent', s.user_agent
    )
  FROM public.security_events s

  UNION ALL

  -- identity_audit_log: actor_id acted on user_id.
  SELECT
    'identity_audit_log'::text,
    i.id::text,
    i.created_at,
    i.actor_id,
    i.action,
    i.user_id::text,
    i.user_id,
    i.action || ' — ' || coalesce(i.outcome, '—'),
    jsonb_build_object(
      'outcome', i.outcome,
      'detail', i.detail
    )
  FROM public.identity_audit_log i

  UNION ALL

  -- p2p_audit_log: actor_id acted on an order; the subject user is
  -- derivable only when the detail payload carries one.
  SELECT
    'p2p_audit_log'::text,
    p.id::text,
    p.created_at,
    p.actor_id,
    p.event,
    p.order_id::text,
    CASE
      WHEN p.detail ->> 'user_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (p.detail ->> 'user_id')::uuid
      ELSE NULL
    END,
    p.event || ' on P2P order',
    jsonb_build_object(
      'actor_type', p.actor_type,
      'order_id', p.order_id,
      'detail', p.detail
    )
  FROM public.p2p_audit_log p

  UNION ALL

  -- p2p_risk_events: system-generated risk signals about a user.
  SELECT
    'p2p_risk_events'::text,
    r.id::text,
    r.created_at,
    NULL::uuid,
    r.signal,
    coalesce(r.order_id::text, r.user_id::text),
    r.user_id,
    r.signal || ' (weight ' || coalesce(r.weight::text, '—') || ')',
    jsonb_build_object(
      'counterparty_id', r.counterparty_id,
      'order_id', r.order_id,
      'weight', r.weight,
      'detail', r.detail
    )
  FROM public.p2p_risk_events r

  UNION ALL

  -- card_access_audit: a user's access attempt against a card.
  SELECT
    'card_access_audit'::text,
    c.id::text,
    c.created_at,
    c.user_id,
    c.action,
    c.card_id::text,
    c.user_id,
    c.action || ' on card (' || CASE WHEN c.success THEN 'success' ELSE 'failed' END || ')',
    jsonb_build_object(
      'card_id', c.card_id,
      'success', c.success,
      'ip_address', c.ip_address
    )
  FROM public.card_access_audit c

  UNION ALL

  -- aml_screenings: a screening run over a user; reviewed_by is the
  -- deciding actor when a review happened.
  SELECT
    'aml_screenings'::text,
    a.id::text,
    a.screened_at,
    a.reviewed_by,
    'aml_screening'::text,
    a.user_id::text,
    a.user_id,
    'AML screening (' || a.screening_type || ') — ' || a.status || ', risk ' || a.risk_level,
    jsonb_build_object(
      'screening_type', a.screening_type,
      'full_name', a.full_name,
      'country', a.country,
      'risk_level', a.risk_level,
      'match_found', a.match_found,
      'match_details', a.match_details,
      'status', a.status,
      'reviewed_by', a.reviewed_by,
      'reviewed_at', a.reviewed_at
    )
  FROM public.aml_screenings a

  UNION ALL

  -- compliance_checks: a check over a user / their transaction.
  SELECT
    'compliance_checks'::text,
    c.id::text,
    c.created_at,
    c.reviewed_by,
    'compliance_check'::text,
    coalesce(c.transaction_id::text, c.user_id::text),
    c.user_id,
    'Compliance check (' || c.check_type || ') — ' || c.status,
    jsonb_build_object(
      'check_type', c.check_type,
      'status', c.status,
      'risk_score', c.risk_score,
      'transaction_id', c.transaction_id,
      'details', c.details,
      'reviewed_by', c.reviewed_by,
      'reviewed_at', c.reviewed_at
    )
  FROM public.compliance_checks c
$function$;

-- ---------------------------------------------------------------------
-- forensic_search: cross-source filtered search, paginated.
-- Filters: actor, action/type (substring), target user, source,
-- date range, free text over action/summary/detail.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forensic_search(
  p_actor uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_target_user uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_text text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE (
   source text,
   event_id text,
   occurred_at timestamptz,
   actor_id uuid,
   action text,
   target_id text,
   target_user_id uuid,
   summary text,
   detail jsonb,
   total_count bigint
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 10000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.has_role(v_caller, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can use the forensic audit tools'
      USING ERRCODE = '42501';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN (
    'audit_logs','role_audit','security_events','identity_audit_log',
    'p2p_audit_log','p2p_risk_events','card_access_audit',
    'aml_screenings','compliance_checks'
  ) THEN
    RAISE EXCEPTION 'Unknown forensic source: %', p_source
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    e.source, e.event_id, e.occurred_at, e.actor_id, e.action,
    e.target_id, e.target_user_id, e.summary, e.detail,
    count(*) OVER ()
  FROM public.forensic_events_feed() e
  WHERE (p_actor IS NULL OR e.actor_id = p_actor)
    AND (p_target_user IS NULL OR e.target_user_id = p_target_user)
    AND (p_source IS NULL OR e.source = p_source)
    AND (p_action IS NULL OR e.action ILIKE '%' || p_action || '%')
    AND (p_from IS NULL OR e.occurred_at >= p_from)
    AND (p_to IS NULL OR e.occurred_at <= p_to)
    AND (p_text IS NULL OR e.action ILIKE '%' || p_text || '%'
         OR e.summary ILIKE '%' || p_text || '%'
         OR e.detail::text ILIKE '%' || p_text || '%')
  ORDER BY e.occurred_at DESC, e.source, e.event_id
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

-- ---------------------------------------------------------------------
-- forensic_user_timeline: every event touching one user — as the
-- actor or as the subject — chronological, one call.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forensic_user_timeline(
  p_user_id uuid,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE (
   source text,
   event_id text,
   occurred_at timestamptz,
   actor_id uuid,
   action text,
   target_id text,
   target_user_id uuid,
   summary text,
   detail jsonb,
   total_count bigint
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 10000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.has_role(v_caller, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can use the forensic audit tools'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A user id is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    e.source, e.event_id, e.occurred_at, e.actor_id, e.action,
    e.target_id, e.target_user_id, e.summary, e.detail,
    count(*) OVER ()
  FROM public.forensic_events_feed() e
  WHERE e.actor_id = p_user_id OR e.target_user_id = p_user_id
  ORDER BY e.occurred_at ASC, e.source, e.event_id
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

-- ---------------------------------------------------------------------
-- forensic_user_evidence: the per-user evidence pack in one call —
-- profile, account email, roles, wallets, latest transactions and
-- the user's full forensic timeline (newest first, capped).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forensic_user_evidence(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_profile jsonb;
  v_email text;
  v_account_created timestamptz;
  v_roles jsonb;
  v_wallets jsonb;
  v_transactions jsonb;
  v_timeline jsonb;
BEGIN
  IF NOT public.has_role(v_caller, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can use the forensic audit tools'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A user id is required' USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(p) INTO v_profile FROM public.profiles p WHERE p.id = p_user_id;
  SELECT u.email, u.created_at INTO v_email, v_account_created
    FROM auth.users u WHERE u.id = p_user_id;
  SELECT coalesce(jsonb_agg(r.role ORDER BY r.role), '[]'::jsonb)
    INTO v_roles FROM public.user_roles r WHERE r.user_id = p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.created_at), '[]'::jsonb)
    INTO v_wallets FROM public.wallets w WHERE w.user_id = p_user_id;
  SELECT coalesce(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v_transactions
    FROM (
      SELECT tx.id, tx.amount, tx.currency, tx.payment_method, tx.direction,
             tx.status, tx.reference, tx.provider, tx.fee_amount,
             tx.description, tx.created_at, tx.updated_at
      FROM public.transactions tx
      WHERE tx.user_id = p_user_id
      ORDER BY tx.created_at DESC
      LIMIT 500
    ) t;
  SELECT coalesce(jsonb_agg(e ORDER BY e.occurred_at DESC), '[]'::jsonb)
    INTO v_timeline
    FROM (
      SELECT f.source, f.event_id, f.occurred_at, f.actor_id, f.action,
             f.target_id, f.target_user_id, f.summary, f.detail
      FROM public.forensic_events_feed() f
      WHERE f.actor_id = p_user_id OR f.target_user_id = p_user_id
      ORDER BY f.occurred_at DESC
      LIMIT 1000
    ) e;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'email', v_email,
    'account_created_at', v_account_created,
    'profile', v_profile,
    'roles', v_roles,
    'wallets', v_wallets,
    'transactions', v_transactions,
    'timeline', v_timeline,
    'generated_at', now()
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- forensic_log_export: the export manifest, written to audit_logs
-- BEFORE the client delivers the download. The row vouches for the
-- payload: kind, format, scope, per-source/section counts, total
-- rows and the SHA-256 of the exact payload bytes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forensic_log_export(
  p_kind text,
  p_format text,
  p_scope jsonb,
  p_counts jsonb,
  p_checksum text,
  p_total_rows integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_id uuid;
BEGIN
  IF NOT public.has_role(v_caller, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can use the forensic audit tools'
      USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('search', 'evidence_pack') THEN
    RAISE EXCEPTION 'Unknown export kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_format NOT IN ('csv', 'json') THEN
    RAISE EXCEPTION 'Unknown export format: %', p_format USING ERRCODE = '22023';
  END IF;
  IF p_checksum IS NULL OR p_checksum !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A SHA-256 checksum (64 hex chars) is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_total_rows IS NULL OR p_total_rows < 0 THEN
    RAISE EXCEPTION 'A valid row count is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller,
    'forensic_export',
    'forensic_exports',
    p_kind,
    jsonb_build_object(
      'kind', p_kind,
      'format', p_format,
      'scope', coalesce(p_scope, '{}'::jsonb),
      'counts', coalesce(p_counts, '{}'::jsonb),
      'total_rows', p_total_rows,
      'checksum_sha256', p_checksum
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- ACLs (CEO grant rule — explicit and scoped, verified by re-read):
-- the internal feed is granted to NO API role; the four public RPCs
-- are authenticated-only (their in-function gate does the real work;
-- anon gets nothing at all).
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.forensic_events_feed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forensic_search(uuid, text, uuid, text, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forensic_search(uuid, text, uuid, text, timestamptz, timestamptz, text, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.forensic_user_timeline(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forensic_user_timeline(uuid, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.forensic_user_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forensic_user_evidence(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.forensic_log_export(text, text, jsonb, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forensic_log_export(text, text, jsonb, jsonb, text, integer) TO authenticated;
