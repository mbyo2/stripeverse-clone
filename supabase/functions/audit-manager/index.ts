
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Admin gate (security audit P0-7, 2026-10-23) ──
    // Every action in this function — including data_retention, which
    // DELETES audit history — requires a signed-in admin. Resolve the
    // caller from their JWT first; anonymous callers get a 401 and
    // non-admin callers a 403, and no action runs.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const requestClient = getSupabaseClient(req);
    const { data: { user }, error: authError } = await requestClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      )
    }

    const supabaseClient = getServiceRoleClient()

    const { data: adminRole } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'super_admin'])
      .maybeSingle()
    if (!adminRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    const { action, filters, export_format, user_ids } = await req.json()

    // FIX-3: actor-label resolution for the Audit Logs page. Profiles
    // carry no email (and, in practice, no names), so the page's own
    // profiles merge resolved every actor blank. This action merges
    // profile names with auth emails service-side; the page falls
    // back to the email whenever the name is blank.
    if (action === 'resolve_actors') {
      return await resolveActors(supabaseClient, user_ids)
    }

    switch (action) {
      case 'generate_report':
        return await generateAuditReport(supabaseClient, filters, export_format)
      
      case 'compliance_check':
        return await runComplianceCheck(supabaseClient, filters)
      
      case 'data_retention':
        return await enforceDataRetention(supabaseClient)
      
      case 'backup_audit_logs':
        return await backupAuditLogs(supabaseClient, filters)
      
      default:
        throw new Error('Invalid action')
    }

  } catch (error) {
    console.error('Audit manager error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

async function generateAuditReport(supabaseClient: any, filters: any, format: string) {
  const f = filters ?? {}

  let query = supabaseClient
    .from('audit_logs')
    .select('*')
    .gte('created_at', f.start_date || '1970-01-01')
    .lte('created_at', f.end_date || new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(f.limit || 1000)

  // Only filter by table when the caller actually supplied one:
  // `.eq('table_name', undefined)` would silently match nothing.
  if (typeof f.table_name === 'string' && f.table_name.length > 0) {
    query = query.eq('table_name', f.table_name)
  }

  const { data: auditLogs, error } = await query

  if (error) {
    throw new Error(`Failed to fetch audit logs: ${error.message}`)
  }

  // audit_logs has NO foreign key to profiles, so PostgREST cannot
  // embed the actor's name — the old `profiles:user_id(...)` embed
  // failed every report with a schema-cache relationship error.
  // Resolve names in a second step, keyed by the distinct actor ids
  // in the result set: the same approach the Audit Logs page uses
  // (src/utils/auditLogProfiles.ts). Names are cosmetic in an
  // export — a missing profile (or a failed lookup) leaves the name
  // blank and never fails the report.
  const actorIds = [...new Set(
    (auditLogs ?? [])
      .map((log: any) => log.user_id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  )]
  const nameById = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: profiles } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', actorIds)
    for (const p of profiles ?? []) {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
      if (name) nameById.set(p.id, name)
    }
    // FIX-3: actors whose profile name is blank fall back to their
    // account EMAIL — a uuid + blank label identified nobody.
    const missing = actorIds.filter((id) => !nameById.has(id))
    if (missing.length > 0) {
      const emailById = await resolveActorEmails(supabaseClient, missing)
      for (const [id, email] of emailById) nameById.set(id, email)
    }
  }
  const records = (auditLogs ?? []).map((log: any) => ({
    ...log,
    actor_name: log.user_id ? nameById.get(log.user_id) ?? '' : '',
  }))

  const report = {
    generated_at: new Date().toISOString(),
    total_records: records.length,
    filters_applied: f,
    summary: generateAuditSummary(records),
    records
  }

  if (format === 'csv') {
    const csv = convertToCSV(records)
    return new Response(csv, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit_report.csv"'
      }
    })
  }

  return new Response(
    JSON.stringify(report),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    }
  )
}

async function runComplianceCheck(supabaseClient: any, filters: any) {
  const checks = []

  // Check for suspicious transaction patterns
  const { data: suspiciousTransactions } = await supabaseClient
    .from('transactions')
    .select('*')
    .eq('status', 'completed')
    .gte('amount', 10000) // Large transactions
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours

  checks.push({
    check_type: 'large_transactions',
    status: suspiciousTransactions?.length > 0 ? 'flagged' : 'passed',
    count: suspiciousTransactions?.length || 0,
    description: 'Transactions over 10,000 ZMW in last 24 hours'
  })

  // Check for failed transactions rate
  const { data: allTransactions } = await supabaseClient
    .from('transactions')
    .select('status')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const failedCount = allTransactions?.filter(t => t.status === 'failed').length || 0
  const failureRate = allTransactions?.length ? (failedCount / allTransactions.length) * 100 : 0

  checks.push({
    check_type: 'transaction_failure_rate',
    status: failureRate > 5 ? 'flagged' : 'passed',
    value: failureRate,
    description: 'Transaction failure rate in last 24 hours'
  })

  // Check for users without KYC
  const { data: unverifiedUsers } = await supabaseClient
    .from('profiles')
    .select(`
      id,
      kyc_verifications(level, verified_at)
    `)
    .is('kyc_verifications.verified_at', null)

  checks.push({
    check_type: 'kyc_compliance',
    status: unverifiedUsers?.length > 0 ? 'attention_required' : 'passed',
    count: unverifiedUsers?.length || 0,
    description: 'Users without completed KYC verification'
  })

  return new Response(
    JSON.stringify({
      compliance_report: {
        generated_at: new Date().toISOString(),
        overall_status: checks.some(c => c.status === 'flagged') ? 'flagged' : 'passed',
        checks
      }
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    }
  )
}

async function enforceDataRetention(supabaseClient: any) {
  const retentionPeriods = {
    audit_logs: 2555, // 7 years in days
    transactions: 2555, // 7 years in days
    user_sessions: 90, // 3 months in days
  }

  const results = []

  for (const [table, days] of Object.entries(retentionPeriods)) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    
    try {
      const { data, error } = await supabaseClient
        .from(table)
        .delete()
        .lt('created_at', cutoffDate)

      results.push({
        table,
        cutoff_date: cutoffDate,
        status: error ? 'failed' : 'success',
        error: error?.message,
        records_affected: data?.length || 0
      })
    } catch (error) {
      results.push({
        table,
        cutoff_date: cutoffDate,
        status: 'failed',
        error: error.message,
        records_affected: 0
      })
    }
  }

  return new Response(
    JSON.stringify({
      data_retention_results: results,
      executed_at: new Date().toISOString()
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    }
  )
}

async function backupAuditLogs(supabaseClient: any, filters: any) {
  const { data: auditLogs, error } = await supabaseClient
    .from('audit_logs')
    .select('*')
    .gte('created_at', filters.start_date || '1970-01-01')
    .lte('created_at', filters.end_date || new Date().toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch audit logs for backup: ${error.message}`)
  }

  // In production, upload to secure storage (S3, etc.)
  const backupData = {
    backup_created_at: new Date().toISOString(),
    record_count: auditLogs.length,
    filters_applied: filters,
    data: auditLogs
  }

  // For now, return the backup data
  // In production, this would be stored securely and return a backup ID
  return new Response(
    JSON.stringify({
      backup_id: `backup_${Date.now()}`,
      status: 'completed',
      record_count: auditLogs.length,
      size_bytes: JSON.stringify(backupData).length
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    }
  )
}

function generateAuditSummary(auditLogs: any[]) {
  const summary = {
    total_records: auditLogs.length,
    actions: {},
    tables: {},
    users: {},
    date_range: {
      earliest: null,
      latest: null
    }
  }

  auditLogs.forEach(log => {
    // Count actions
    summary.actions[log.action] = (summary.actions[log.action] || 0) + 1
    
    // Count tables
    summary.tables[log.table_name] = (summary.tables[log.table_name] || 0) + 1
    
    // Count users
    if (log.user_id) {
      summary.users[log.user_id] = (summary.users[log.user_id] || 0) + 1
    }
    
    // Track date range
    const logDate = new Date(log.created_at)
    if (!summary.date_range.earliest || logDate < new Date(summary.date_range.earliest)) {
      summary.date_range.earliest = log.created_at
    }
    if (!summary.date_range.latest || logDate > new Date(summary.date_range.latest)) {
      summary.date_range.latest = log.created_at
    }
  })

  return summary
}

function convertToCSV(data: any[]): string {
  if (data.length === 0) return ''
  
  const headers = Object.keys(data[0])
  const csvRows = [headers.join(',')]
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header]
      if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`
      // jsonb cells (old_values / new_values) arrive as objects/arrays:
      // render their JSON text, quoted like a string — never the raw
      // object, which stringifies as "[object Object]".
      if (value !== null && typeof value === 'object') {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`
      }
      return value
    })
    csvRows.push(values.join(','))
  }
  
  return csvRows.join('\n')
}

// ── FIX-3 helpers ────────────────────────────────────────────────────
// Resolve account emails for actor ids via the auth admin API
// (paged listUsers; stops as soon as every wanted id is found).
async function resolveActorEmails(supabaseClient: any, wantedIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(wantedIds)
  const found = new Map<string, string>()
  if (wanted.size === 0) return found
  for (let page = 1; page <= 5 && found.size < wanted.size; page++) {
    const { data, error } = await supabaseClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users) break
    for (const u of data.users) {
      if (wanted.has(u.id) && u.email) found.set(u.id, u.email)
    }
    if (data.users.length < 1000) break
  }
  return found
}

async function resolveActors(supabaseClient: any, userIds: unknown) {
  const ids = Array.isArray(userIds)
    ? [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 200)
    : []
  const { data: profiles } = ids.length > 0
    ? await supabaseClient.from('profiles').select('id, first_name, last_name').in('id', ids)
    : { data: [] }
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]))
  const blankIds = ids.filter((id) => {
    const p = byId.get(id)
    const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : ''
    return !name
  })
  const emailById = await resolveActorEmails(supabaseClient, blankIds)
  const actors = ids.map((id) => {
    const p = byId.get(id)
    return {
      id,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      email: emailById.get(id) ?? null,
    }
  })
  return new Response(
    JSON.stringify({ success: true, actors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
  )
}
