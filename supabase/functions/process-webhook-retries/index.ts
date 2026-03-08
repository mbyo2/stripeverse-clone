import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch pending webhook deliveries that are due for retry
    const { data: pending, error } = await supabase
      .from('webhook_delivery_logs')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', new Date().toISOString())
      .lt('attempts', 5)
      .order('next_retry_at', { ascending: true })
      .limit(50);

    if (error) throw error;

    const results = [];

    for (const log of pending || []) {
      const attempt = log.attempts + 1;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(log.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BMGlass-Event': log.event_type,
            'X-BMGlass-Delivery': log.event_id,
            'X-BMGlass-Attempt': String(attempt),
          },
          body: JSON.stringify(log.payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          await supabase
            .from('webhook_delivery_logs')
            .update({
              status: 'success',
              attempts: attempt,
              last_attempt_at: new Date().toISOString(),
              response_status: response.status,
            })
            .eq('id', log.id);

          results.push({ id: log.id, status: 'success' });
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (err: any) {
        // Exponential backoff: 2^attempt seconds (2s, 4s, 8s, 16s, 32s)
        const backoffSeconds = Math.pow(2, attempt);
        const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        const newStatus = attempt >= 5 ? 'failed' : 'retrying';

        await supabase
          .from('webhook_delivery_logs')
          .update({
            status: newStatus,
            attempts: attempt,
            last_attempt_at: new Date().toISOString(),
            next_retry_at: nextRetry,
            error_message: err.message || 'Unknown error',
          })
          .eq('id', log.id);

        results.push({ id: log.id, status: newStatus, error: err.message });
      }
    }

    return new Response(JSON.stringify({
      processed: results.length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
