import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReceiptRequest {
  transaction_id: string;
  recipient_email: string;
  type: 'payment' | 'refund' | 'transfer' | 'invoice';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { transaction_id, recipient_email, type = 'payment' } = await req.json() as ReceiptRequest;

    if (!transaction_id || !recipient_email) {
      return new Response(
        JSON.stringify({ error: 'transaction_id and recipient_email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch transaction details
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('uuid_id', transaction_id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build receipt HTML
    const receiptHtml = generateReceiptHtml(transaction, type);

    // Log the receipt notification
    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: transaction.user_id,
        title: `Receipt sent for ${type}`,
        message: `A ${type} receipt for ${transaction.currency} ${transaction.amount} has been sent to ${recipient_email}`,
        type: 'transaction',
      });

    // In production, integrate with email provider (SendGrid, Postmark, etc.)
    // For now, store the receipt data and create notification
    console.log(`Receipt generated for ${transaction_id} → ${recipient_email}`);

    return new Response(
      JSON.stringify({
        success: true,
        receipt: {
          transaction_id,
          recipient_email,
          type,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
          date: transaction.created_at,
          reference: `RCP-${transaction_id.slice(0, 8).toUpperCase()}`,
          html: receiptHtml,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Receipt generation error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate receipt' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateReceiptHtml(transaction: any, type: string): string {
  const date = new Date(transaction.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #1e40af; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">BMaGlass Pay</h1>
      <p style="margin: 4px 0 0; opacity: 0.85; font-size: 14px;">${type === 'refund' ? 'Refund' : 'Payment'} Receipt</p>
    </div>
    <div style="padding: 24px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <p style="font-size: 32px; font-weight: 700; margin: 0; color: ${type === 'refund' ? '#dc2626' : '#16a34a'};">
          ${type === 'refund' ? '-' : ''}${transaction.currency} ${Number(transaction.amount).toFixed(2)}
        </p>
        <p style="color: #71717a; margin: 4px 0 0; font-size: 14px;">${transaction.status === 'completed' ? '✓ Completed' : transaction.status}</p>
      </div>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 16px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #71717a; padding: 6px 0;">Reference</td><td style="text-align: right; font-weight: 500;">RCP-${(transaction.uuid_id || transaction.id).toString().slice(0, 8).toUpperCase()}</td></tr>
        <tr><td style="color: #71717a; padding: 6px 0;">Date</td><td style="text-align: right;">${date}</td></tr>
        <tr><td style="color: #71717a; padding: 6px 0;">Recipient</td><td style="text-align: right;">${transaction.recipient_name || 'N/A'}</td></tr>
        <tr><td style="color: #71717a; padding: 6px 0;">Category</td><td style="text-align: right;">${transaction.category || 'General'}</td></tr>
        ${transaction.fee_amount ? `<tr><td style="color: #71717a; padding: 6px 0;">Fee</td><td style="text-align: right;">${transaction.currency} ${Number(transaction.fee_amount).toFixed(2)}</td></tr>` : ''}
      </table>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 16px 0;">
      <p style="font-size: 12px; color: #a1a1aa; text-align: center;">
        This is an automated receipt from BMaGlass Pay.<br>
        For questions, contact support@bmaglasspay.com
      </p>
    </div>
  </div>
</body>
</html>`;
}
