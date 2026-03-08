import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

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
      const { error } = await supabase
        .from('webhook_delivery_logs')
        .update({
          status: 'pending',
          next_retry_at: new Date().toISOString(),
        })
        .eq('id', logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-logs'] });
      toast({ title: 'Webhook queued for retry' });
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
