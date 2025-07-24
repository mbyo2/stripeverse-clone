import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export const useRoleManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const requestRoleChange = async (newRole: string, reason?: string) => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      // Validate role change through secure function
      const { data, error } = await supabase.rpc('validate_role_change', {
        p_user_id: user.id,
        p_new_role: newRole,
        p_changed_by: user.id,
        p_reason: reason || 'Self-requested role change'
      });

      if (error) throw error;

      if (data) {
        toast({
          title: "Role Change Approved",
          description: "Your role has been successfully updated.",
        });
      } else {
        toast({
          title: "Role Change Pending",
          description: "Your role change request has been submitted for review.",
        });
      }

      return data;
    } catch (error) {
      console.error('Error requesting role change:', error);
      toast({
        title: "Error",
        description: "Failed to request role change",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    requestRoleChange,
  };
};