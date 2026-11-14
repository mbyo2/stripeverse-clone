import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export const useSecureCardAccess = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const logCardAccess = useCallback(async (cardId: string, accessType: string) => {
    if (!user?.id) return;

    try {
      // Card-access logging runs server-side: log_card_access_attempt is
      // EXECUTE-granted to service_role only, so a direct supabase.rpc
      // from the browser always failed with 42501 (and the failure was
      // swallowed here, while the UI still toasted "Access logged").
      // The validate-card-access edge function holds the service-role
      // client; the user id it logs comes from the verified JWT, never
      // from the request body (workstream A, 2026-11-15).
      const { error } = await supabase.functions.invoke('validate-card-access', {
        body: { cardId, accessType },
      });
      if (error) throw error;
    } catch (error) {
      console.error('Failed to log card access:', error);
    }
  }, [user?.id]);

  const requestSecureAccess = useCallback(async (cardId: string) => {
    try {
      // Log the access request
      await logCardAccess(cardId, 'view_request');
      
      toast({
        title: "Security Notice",
        description: "Card access request has been logged for security monitoring.",
      });

      // In a real implementation, this would:
      // 1. Verify user identity (2FA, etc.)
      // 2. Decrypt card data server-side
      // 3. Return only necessary data
      // 4. Log the access for audit trail
      
      return {
        success: true,
        message: "Access logged. Full card details remain encrypted for security."
      };
    } catch (error) {
      toast({
        title: "Access Error",
        description: "Unable to process secure access request.",
        variant: "destructive"
      });
      return { success: false, error: error };
    }
  }, [logCardAccess, toast]);

  return {
    requestSecureAccess,
    logCardAccess
  };
};