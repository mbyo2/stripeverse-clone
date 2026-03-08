import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface SavedContact {
  id: string;
  user_id: string;
  contact_name: string;
  phone_number: string | null;
  email: string | null;
  is_favorite: boolean;
  last_transacted_at: string | null;
  transaction_count: number;
  avatar_url: string | null;
  notes: string | null;
  created_at: string;
}

export const useSavedContacts = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['saved-contacts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_contacts')
        .select('*')
        .eq('user_id', user!.id)
        .order('is_favorite', { ascending: false })
        .order('transaction_count', { ascending: false });
      if (error) throw error;
      return data as SavedContact[];
    },
    enabled: !!user?.id,
  });

  const addContact = useMutation({
    mutationFn: async (params: {
      contact_name: string;
      phone_number?: string;
      email?: string;
      is_favorite?: boolean;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from('saved_contacts')
        .insert({ user_id: user!.id, ...params })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-contacts'] });
      toast({ title: 'Contact saved' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, is_favorite }: { id: string; is_favorite: boolean }) => {
      const { error } = await supabase
        .from('saved_contacts')
        .update({ is_favorite, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-contacts'] });
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('saved_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-contacts'] });
      toast({ title: 'Contact removed' });
    },
  });

  const favorites = contacts.filter((c) => c.is_favorite);
  const recent = contacts.filter((c) => c.last_transacted_at).slice(0, 5);

  return { contacts, favorites, recent, isLoading, addContact, toggleFavorite, deleteContact };
};
