import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle, Activity } from 'lucide-react';

export const SecurityMonitor: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  // Run security maintenance on component mount
  useEffect(() => {
    const runSecurityMaintenance = async () => {
      if (!user?.id) return;

      try {
        await supabase.rpc('run_security_maintenance');
      } catch (error) {
        console.error('Security maintenance failed:', error);
      }
    };

    runSecurityMaintenance();

    // Set up interval for regular maintenance (every hour)
    const interval = setInterval(runSecurityMaintenance, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Monitor for high-risk security events
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('security-monitoring')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'security_events',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const event = payload.new as any;
          if (event.risk_score >= 7) {
            toast({
              title: "Security Alert",
              description: `High-risk security event detected: ${event.event_type}`,
              variant: "destructive"
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Security Status</CardTitle>
          <Shield className="h-4 w-4 text-muted-foreground ml-auto" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              Active Monitoring
            </Badge>
            <Activity className="h-4 w-4 text-green-500" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Real-time security monitoring is active
          </p>
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Security measures are continuously monitoring your account for suspicious activity.
          Enhanced encryption and rate limiting are active.
        </AlertDescription>
      </Alert>
    </div>
  );
};