import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { toUserFacingError } from '@/utils/userFacingError';

export interface WebhookDeliveryLog {
  id: string;
  business_id: string;
  event_id: string;
  event_type: string;
  webhook_url: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  error_message: string | null;
  response_status: number | null;
  created_at: string;
}

export const useWebhookRetries = (businessId?: string) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['webhook-logs', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('webhook_delivery_logs')
        .select('*')
        .eq('business_id', businessId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as unknown) as WebhookDeliveryLog[];
    },
    enabled: !!businessId,
  });

  const retryWebhook = useMutation({
    mutationFn: async (logId: string) => {
      // The retry transition runs through the request_webhook_retry RPC,
      // which verifies that the delivery's business belongs to the caller
      // and only performs the failed -> pending transition. A direct
      // table update is not permitted (and would let a merchant rewrite
      // their own delivery history).
      const { error } = await (supabase as any).rpc('request_webhook_retry', {
        p_log_id: logId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-logs'] });
      toast({ title: 'Webhook queued for retry' });
    },
    onError: (error) => {
      toast({
        title: "Couldn't queue the retry",
        description: toUserFacingError(error),
        variant: 'destructive',
      });
    },
  });

  const stats = {
    total: logs.length,
    success: logs.filter(l => l.status === 'success').length,
    failed: logs.filter(l => l.status === 'failed').length,
    pending: logs.filter(l => l.status === 'pending' || l.status === 'retrying').length,
  };

  return { logs, isLoading, retryWebhook, stats };
};
