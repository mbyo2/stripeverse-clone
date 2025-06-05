
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';

interface AuditFilters {
  start_date?: string;
  end_date?: string;
  table_name?: string;
  action?: string;
  user_id?: string;
  limit?: number;
}

export const useAuditLogs = () => {
  const [filters, setFilters] = useState<AuditFilters>({});
  const queryClient = useQueryClient();

  const { data: auditLogs, isLoading, error } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select(`
          *,
          profiles:user_id(first_name, last_name)
        `)
        .order('created_at', { ascending: false });

      if (filters.start_date) {
        query = query.gte('created_at', filters.start_date);
      }
      if (filters.end_date) {
        query = query.lte('created_at', filters.end_date);
      }
      if (filters.table_name) {
        query = query.eq('table_name', filters.table_name);
      }
      if (filters.action) {
        query = query.eq('action', filters.action);
      }
      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id);
      }

      query = query.limit(filters.limit || 100);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const generateReportMutation = useMutation({
    mutationFn: async ({ filters, format }: { filters: AuditFilters; format: string }) => {
      const { data, error } = await supabase.functions.invoke('audit-manager', {
        body: {
          action: 'generate_report',
          filters,
          export_format: format
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Report Generated",
        description: "Audit report has been generated successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Report Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate report",
        variant: "destructive"
      });
    }
  });

  const complianceCheckMutation = useMutation({
    mutationFn: async (filters: AuditFilters) => {
      const { data, error } = await supabase.functions.invoke('audit-manager', {
        body: {
          action: 'compliance_check',
          filters
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Compliance Check Completed",
        description: "Compliance check has been completed successfully."
      });
    }
  });

  const dataRetentionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('audit-manager', {
        body: { action: 'data_retention' }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Data Retention Enforced",
        description: "Data retention policies have been applied successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    }
  });

  return {
    auditLogs,
    isLoading,
    error,
    filters,
    setFilters,
    generateReport: generateReportMutation.mutate,
    runComplianceCheck: complianceCheckMutation.mutate,
    enforceDataRetention: dataRetentionMutation.mutate,
    isGeneratingReport: generateReportMutation.isPending,
    isRunningComplianceCheck: complianceCheckMutation.isPending,
    isEnforcingRetention: dataRetentionMutation.isPending
  };
};
