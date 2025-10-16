
import { supabase } from "@/integrations/supabase/client";

export interface WebhookPayload {
  event_type: string;
  event_id: string;
  timestamp: string;
  business_id: string;
  data: unknown;
}

interface WebhookDeliveryResult {
  success: boolean;
  status?: number;
  message?: string;
  retryCount?: number;
}

export interface WebhookEventLog {
  event_id: string;
  business_id: string;
  event_type: string;
  payload: object;
  status: 'success' | 'failed' | 'retrying';
  attempts: number;
  created_at: string;
  last_attempt_at: string;
  webhook_url: string;
  attempt_count?: number;
  max_attempts?: number;
  error_message?: string;
}

/**
 * Delivers webhook to a business endpoint
 * @param businessId - The ID of the business to deliver the webhook to
 * @param eventType - The type of event that occurred
 * @param data - The data associated with the event
 * @param retryCount - Number of retry attempts (for internal use)
 */
export async function deliverWebhook(
  businessId: string, 
  eventType: string, 
  data: unknown,
  retryCount = 0
): Promise<WebhookDeliveryResult> {
  try {
    // Fetch webhook configuration for the business
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('url, events')
      .eq('business_id', businessId)
      .single();

    if (error || !webhook) {
      console.error('No webhook configuration found:', error);
      return { success: false, message: 'No webhook configuration found' };
    }

    // Check if the business has subscribed to this event type
    if (!webhook.events[eventType]) {
      return { success: false, message: 'Business not subscribed to this event' };
    }

    // Prepare webhook payload
    const payload: WebhookPayload = {
      event_type: eventType,
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      business_id: businessId,
      data
    };

    // Log the webhook attempt before sending
    await logWebhookEvent({
      event_id: payload.event_id,
      business_id: businessId,
      event_type: eventType,
      payload,
      status: 'retrying',
      attempts: retryCount + 1,
      created_at: payload.timestamp,
      last_attempt_at: new Date().toISOString(),
      webhook_url: webhook.url,
      attempt_count: retryCount + 1,
      max_attempts: 3
    });

    // Set timeout to avoid long-running requests (5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Generate secure signature
    const signature = await generateWebhookSignature(payload, businessId);
    
    // Send the webhook with timeout
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BMGlass-Signature': signature,
        'X-BMGlass-Event': eventType,
        'X-BMGlass-Timestamp': payload.timestamp
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle response
    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.statusText}`);
    }

    // Update webhook log on success
    await updateWebhookEventLog(payload.event_id, 'success');

    // Webhook delivered successfully
    return { 
      success: true, 
      status: response.status,
      retryCount
    };
  } catch (error: any) {
    console.error('Error delivering webhook:', error);
    
    // Handle retry logic if needed
    if (retryCount < 3) {
      // Retrying webhook delivery with exponential backoff
      
      // Exponential backoff: wait longer between each retry
      const backoffMs = Math.pow(2, retryCount) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      
      return deliverWebhook(businessId, eventType, data, retryCount + 1);
    }
    
    // Update webhook log on final failure
    if (error.event_id) {
      await updateWebhookEventLog(
        error.event_id, 
        'failed', 
        error.message || 'Unknown error'
      );
    }
    
    return { 
      success: false, 
      message: error.message || 'Unknown error',
      retryCount 
    };
  }
}

/**
 * Generates a secure HMAC-SHA256 signature for webhook verification
 */
async function generateWebhookSignature(payload: WebhookPayload, businessId: string): Promise<string> {
  try {
    // Fetch business webhook secret from database
    const { data: webhook } = await supabase
      .from('webhooks')
      .select('webhook_secret')
      .eq('business_id', businessId)
      .single();
    
    if (!webhook?.webhook_secret) {
      console.warn('No webhook secret configured for business:', businessId);
      return '';
    }
    
    // Generate HMAC-SHA256 signature
    const payloadString = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhook.webhook_secret);
    const messageData = encoder.encode(payloadString);
    
    // Create HMAC key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Generate signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `sha256=${signatureHex}`;
  } catch (error) {
    console.error('Error generating webhook signature:', error);
    return '';
  }
}

/**
 * Logs a webhook event to the database
 */
async function logWebhookEvent(eventLog: WebhookEventLog): Promise<void> {
  try {
    // Temporarily disable webhook logging since table doesn't exist yet
    console.log('Webhook event would be logged:', {
      event_id: eventLog.event_id,
      webhook_url: eventLog.webhook_url,
      event_type: eventLog.event_type,
      status: eventLog.status
    });
  } catch (error) {
    console.error('Error logging webhook event:', error);
  }
}

/**
 * Updates the status of a webhook event log
 */
async function updateWebhookEventLog(
  eventId: string, 
  status: 'success' | 'failed' | 'retrying',
  errorMessage?: string
): Promise<void> {
  try {
    // Temporarily disable webhook log updates since function doesn't exist yet
    console.log('Webhook log update would be performed:', {
      event_id: eventId,
      status,
      error_message: errorMessage
    });
  } catch (error) {
    console.error('Error updating webhook event log:', error);
  }
}

/**
 * Helper function to trigger a test webhook for a business
 */
export async function sendTestWebhook(businessId: string): Promise<WebhookDeliveryResult> {
  const testData = {
    test: true,
    message: "This is a test webhook",
    timestamp: new Date().toISOString()
  };
  
  return deliverWebhook(businessId, 'test.webhook', testData);
}

/**
 * Check if a webhook URL is valid and reachable
 */
export async function validateWebhookUrl(url: string): Promise<boolean> {
  try {
    // Simple validation - check if URL is properly formatted
    new URL(url);
    
    // Additional check - optional ping to see if endpoint is reachable
    // This is just a basic validation, not a comprehensive check
    return true;
  } catch (error) {
    console.error('Invalid webhook URL:', error);
    return false;
  }
}
