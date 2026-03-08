import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useFraudRules = () => {
  const queryClient = useQueryClient();

  const rules = useQuery({
    queryKey: ['fraud-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fraud_rules')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createRule = useMutation({
    mutationFn: async (rule: { name: string; description?: string; rule_type: string; conditions: Record<string, any>; action: string; severity: string }) => {
      const { data, error } = await supabase.from('fraud_rules').insert(rule).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Fraud rule created'); queryClient.invalidateQueries({ queryKey: ['fraud-rules'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('fraud_rules').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fraud-rules'] }); },
  });

  return { rules, createRule, toggleRule };
};
