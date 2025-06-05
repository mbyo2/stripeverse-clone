
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { action, filters, export_format } = await req.json()

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
  const { data: auditLogs, error } = await supabaseClient
    .from('audit_logs')
    .select(`
      *,
      profiles:user_id(first_name, last_name)
    `)
    .gte('created_at', filters.start_date || '1970-01-01')
    .lte('created_at', filters.end_date || new Date().toISOString())
    .eq('table_name', filters.table_name || filters.table_name)
    .order('created_at', { ascending: false })
    .limit(filters.limit || 1000)

  if (error) {
    throw new Error(`Failed to fetch audit logs: ${error.message}`)
  }

  const report = {
    generated_at: new Date().toISOString(),
    total_records: auditLogs.length,
    filters_applied: filters,
    summary: generateAuditSummary(auditLogs),
    records: auditLogs
  }

  if (format === 'csv') {
    const csv = convertToCSV(auditLogs)
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
      return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
    })
    csvRows.push(values.join(','))
  }
  
  return csvRows.join('\n')
}
