import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export const useAmlScreening = () => {
  const { user } = useAuth();

  const screenings = useQuery({
    queryKey: ['aml-screenings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('aml_screenings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return { screenings };
};
