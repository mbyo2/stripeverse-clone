import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmailPayload {
  type: 'transaction_receipt' | 'security_alert' | 'kyc_status' | 'welcome' | 'deposit_confirmed'
  userId: string
  data?: Record<string, unknown>
}

const emailTemplates = {
  welcome: (name: string) => ({
    subject: 'Welcome to BMaGlass Pay!',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e;">Welcome to BMaGlass Pay, ${name}! 🎉</h1>
        <p>Your account has been created successfully. Here's what you can do next:</p>
        <ul>
          <li>Complete your KYC verification to unlock all features</li>
          <li>Add funds to your wallet</li>
          <li>Explore our payment services</li>
        </ul>
        <a href="https://bmaglasspay.com/dashboard" style="display: inline-block; background: #1a1a2e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">Go to Dashboard</a>
        <p style="color: #666; margin-top: 24px; font-size: 12px;">BMaGlass Pay - Zambia's Premier Payment Gateway</p>
      </div>
    `,
  }),
  
  transaction_receipt: (data: Record<string, unknown>) => ({
    subject: `Transaction ${data.direction === 'incoming' ? 'Received' : 'Sent'} - ${data.amount} ${data.currency}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e;">Transaction ${data.direction === 'incoming' ? 'Received' : 'Confirmation'}</h1>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Amount:</strong> ${data.amount} ${data.currency}</p>
          <p><strong>Type:</strong> ${data.direction}</p>
          <p><strong>Reference:</strong> ${data.reference || 'N/A'}</p>
          <p><strong>Status:</strong> ${data.status}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        <a href="https://bmaglasspay.com/transactions" style="display: inline-block; background: #1a1a2e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Transactions</a>
        <p style="color: #666; margin-top: 24px; font-size: 12px;">If you didn't make this transaction, please contact support immediately.</p>
      </div>
    `,
  }),
  
  security_alert: (data: Record<string, unknown>) => ({
    subject: '⚠️ Security Alert - BMaGlass Pay',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #dc2626;">⚠️ Security Alert</h1>
        <p>We detected unusual activity on your account:</p>
        <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; margin: 16px 0;">
          <p><strong>Event:</strong> ${data.event_type}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          ${data.ip_address ? `<p><strong>IP Address:</strong> ${data.ip_address}</p>` : ''}
        </div>
        <p>If this was you, no action is needed. Otherwise, please secure your account immediately:</p>
        <a href="https://bmaglasspay.com/security-settings" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Secure Account</a>
      </div>
    `,
  }),
  
  kyc_status: (data: Record<string, unknown>) => ({
    subject: `KYC Verification ${data.status === 'approved' ? 'Approved ✅' : 'Update Required'}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e;">KYC Verification ${data.status === 'approved' ? 'Approved ✅' : 'Update Required'}</h1>
        <p>${data.status === 'approved' 
          ? 'Your identity verification has been approved. You now have full access to all platform features.' 
          : 'We need additional information to complete your verification. Please update your documents.'
        }</p>
        <a href="https://bmaglasspay.com/kyc" style="display: inline-block; background: #1a1a2e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">${data.status === 'approved' ? 'View Dashboard' : 'Update Documents'}</a>
      </div>
    `,
  }),
  
  deposit_confirmed: (data: Record<string, unknown>) => ({
    subject: `Deposit Confirmed - ${data.amount} ${data.currency}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #16a34a;">Deposit Confirmed ✅</h1>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Amount:</strong> ${data.amount} ${data.currency}</p>
          <p><strong>Method:</strong> ${data.method || 'Wallet'}</p>
          <p><strong>New Balance:</strong> ${data.new_balance} ${data.currency}</p>
        </div>
        <a href="https://bmaglasspay.com/wallet" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Wallet</a>
      </div>
    `,
  }),
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { type, userId, data } = await req.json() as EmailPayload

    // Get user email and profile
    const { data: { user }, error: userError } = await supabaseClient.auth.admin.getUserById(userId)
    if (userError || !user?.email) {
      throw new Error('User not found or no email')
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .single()

    const name = profile?.first_name || user.email.split('@')[0]

    // Check notification preferences
    const { data: prefs } = await supabaseClient
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    // Respect notification preferences
    if (prefs) {
      if (type === 'transaction_receipt' && !prefs.email_transactions) {
        return new Response(JSON.stringify({ skipped: true, reason: 'user_opted_out' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (type === 'security_alert' && !prefs.email_security) {
        return new Response(JSON.stringify({ skipped: true, reason: 'user_opted_out' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    // Generate email content
    let emailContent: { subject: string; html: string }
    switch (type) {
      case 'welcome':
        emailContent = emailTemplates.welcome(name)
        break
      case 'transaction_receipt':
        emailContent = emailTemplates.transaction_receipt(data || {})
        break
      case 'security_alert':
        emailContent = emailTemplates.security_alert(data || {})
        break
      case 'kyc_status':
        emailContent = emailTemplates.kyc_status(data || {})
        break
      case 'deposit_confirmed':
        emailContent = emailTemplates.deposit_confirmed(data || {})
        break
      default:
        throw new Error(`Unknown email type: ${type}`)
    }

    // Log the notification (in production, integrate with an email provider like Resend/SendGrid)
    await supabaseClient.from('notifications').insert({
      user_id: userId,
      title: emailContent.subject,
      message: `Email notification: ${type}`,
      type: type === 'security_alert' ? 'security' : 'transaction',
    })

    console.log(`Email notification queued: ${type} for user ${userId}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        type, 
        subject: emailContent.subject,
        note: 'Email queued. Connect an email provider (Resend, SendGrid) for actual delivery.' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Email notification error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
