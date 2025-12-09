import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export type DisputeType = 'unauthorized' | 'duplicate' | 'incorrect_amount' | 'service_not_received' | 'other';
export type DisputeStatus = 'pending' | 'under_review' | 'resolved' | 'rejected' | 'escalated';

export interface Dispute {
  id: string;
  transaction_id: string;
  user_id: string;
  dispute_type: DisputeType;
  status: DisputeStatus;
  description: string;
  evidence_urls: string[];
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  refund_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  sender_id: string;
  message: string;
  is_internal: boolean;
  created_at: string;
}

export interface CreateDisputeInput {
  transaction_id: string;
  dispute_type: DisputeType;
  description: string;
  evidence_urls?: string[];
}

export const useDisputes = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: disputes = [], isLoading, error } = useQuery({
    queryKey: ['disputes', user?.id],
    queryFn: async (): Promise<Dispute[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('transaction_disputes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Dispute[];
    },
    enabled: !!user?.id,
  });

  const createDisputeMutation = useMutation({
    mutationFn: async (input: CreateDisputeInput) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('transaction_disputes')
        .insert({
          ...input,
          user_id: user.id,
          evidence_urls: input.evidence_urls || [],
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disputes'] });
      toast({
        title: 'Dispute Created',
        description: 'Your dispute has been submitted for review.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create dispute',
        variant: 'destructive',
      });
    },
  });

  const updateDisputeMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Dispute> & { id: string }) => {
      const { data, error } = await supabase
        .from('transaction_disputes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disputes'] });
      toast({
        title: 'Dispute Updated',
        description: 'Your dispute has been updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update dispute',
        variant: 'destructive',
      });
    },
  });

  return {
    disputes,
    isLoading,
    error,
    createDispute: createDisputeMutation.mutate,
    updateDispute: updateDisputeMutation.mutate,
    isCreating: createDisputeMutation.isPending,
    isUpdating: updateDisputeMutation.isPending,
  };
};

export const useDisputeMessages = (disputeId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['dispute-messages', disputeId],
    queryFn: async (): Promise<DisputeMessage[]> => {
      if (!disputeId) return [];

      const { data, error } = await supabase
        .from('dispute_messages')
        .select('*')
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as DisputeMessage[];
    },
    enabled: !!disputeId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ disputeId, message }: { disputeId: string; message: string }) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('dispute_messages')
        .insert({
          dispute_id: disputeId,
          sender_id: user.id,
          message,
          is_internal: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispute-messages', disputeId] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send message',
        variant: 'destructive',
      });
    },
  });

  return {
    messages,
    isLoading,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
  };
};
