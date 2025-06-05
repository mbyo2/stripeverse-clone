
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';

interface BackupOptions {
  tables?: string[];
  backup_type?: 'full' | 'incremental';
}

interface RestoreOptions {
  backup_id: string;
  tables_to_restore?: string[];
  restore_mode?: 'replace' | 'merge';
}

export const useBackupManager = () => {
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);

  const { data: backups, isLoading: isLoadingBackups, refetch: refetchBackups } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: { action: 'list_backups' }
      });

      if (error) throw error;
      return data.backups;
    }
  });

  const createBackupMutation = useMutation({
    mutationFn: async (options: BackupOptions) => {
      setIsCreatingBackup(true);
      
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'create_backup',
          tables: options.tables,
          backup_type: options.backup_type || 'full'
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Backup Created",
        description: `Backup ${data.backup.backup_id} created successfully with ${data.backup.total_records} records.`
      });
      refetchBackups();
      setIsCreatingBackup(false);
    },
    onError: (error) => {
      toast({
        title: "Backup Failed",
        description: error instanceof Error ? error.message : "Failed to create backup",
        variant: "destructive"
      });
      setIsCreatingBackup(false);
    }
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (options: RestoreOptions) => {
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'restore_backup',
          ...options
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Restore Completed",
        description: `Backup ${data.backup_id} restored successfully.`
      });
    },
    onError: (error) => {
      toast({
        title: "Restore Failed",
        description: error instanceof Error ? error.message : "Failed to restore backup",
        variant: "destructive"
      });
    }
  });

  const scheduleBackupMutation = useMutation({
    mutationFn: async (scheduleData: {
      frequency: 'daily' | 'weekly' | 'monthly';
      backup_type: 'full' | 'incremental';
      tables?: string[];
      enabled?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'schedule_backup',
          ...scheduleData
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Backup Scheduled",
        description: data.message
      });
    }
  });

  return {
    backups,
    isLoadingBackups,
    createBackup: createBackupMutation.mutate,
    restoreBackup: restoreBackupMutation.mutate,
    scheduleBackup: scheduleBackupMutation.mutate,
    isCreatingBackup: isCreatingBackup || createBackupMutation.isPending,
    isRestoringBackup: restoreBackupMutation.isPending,
    isSchedulingBackup: scheduleBackupMutation.isPending,
    refetchBackups
  };
};
