import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UserProfile {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  /** profiles.is_frozen — the flag the money paths enforce. The
   * dashboard reads it to warn a frozen user up front (banner)
   * instead of letting them discover the freeze at send time. */
  is_frozen?: boolean | null;
}

/**
 * The signed-in user's row from public.profiles — the record the
 * Settings page reads and writes, so it is the source of truth for
 * anything user-facing (display name, avatar, phone).
 *
 * Do NOT substitute auth user_metadata for this: metadata is written
 * once at account creation (and not at all for dashboard-created
 * accounts), while profiles is what the user can actually edit.
 * A dashboard that greeted from metadata showed "Welcome back, there"
 * to users who had saved their name in Settings (QA Wave 4).
 */
export const useProfile = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<UserProfile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, avatar_url, is_frozen')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
};

export { resolveFirstName } from '@/utils/displayName';
