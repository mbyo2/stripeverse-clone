import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useAgentNetwork = () => {
  const agents = useQuery({
    queryKey: ['agent-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_locations')
        .select('*')
        .eq('is_active', true)
        .order('city');
      if (error) throw error;
      return data;
    },
  });

  return { agents };
};
