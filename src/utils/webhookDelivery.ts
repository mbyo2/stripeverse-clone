
import { supabase } from "@/integrations/supabase/client";

export interface WebhookPayload {
  event_type: string;
  event_id: string;
  timestamp: string;
  business_id: string;
  data: unknown;
}

export async function deliverWebhook(businessId: string, eventType: string, data: unknown) {
  try {
    // Fetch webhook configuration for the business
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('url, events')
      .eq('business_id', businessId)
      .single();

    if (error || !webhook) {
      console.error('No webhook configuration found:', error);
      return;
    }

    // Check if the business has subscribed to this event type
    if (!webhook.events[eventType]) {
      console.log(`Business ${businessId} not subscribed to event ${eventType}`);
      return;
    }

    // Prepare webhook payload
    const payload: WebhookPayload = {
      event_type: eventType,
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      business_id: businessId,
      data
    };

    // Send the webhook
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.statusText}`);
    }

    console.log(`Webhook delivered successfully to ${webhook.url}`);
    return true;
  } catch (error) {
    console.error('Error delivering webhook:', error);
    return false;
  }
}
