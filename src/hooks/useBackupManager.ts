
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

interface BackupConfig {
  availableTables: string[];
  maxBackupsToKeep: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  retentionDays: number;
  scheduleOptions: {
    frequency: ('daily' | 'weekly' | 'monthly')[];
    allowedHours: number[];
  };
}

export const useBackupManager = () => {
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [config, setConfig] = useState<BackupConfig>({
    availableTables: [
      'profiles',
      'wallets', 
      'transactions',
      'virtual_cards',
      'payment_methods',
      'merchant_accounts',
      'kyc_verifications',
      'compliance_checks',
      'audit_logs'
    ],
    maxBackupsToKeep: 10,
    compressionEnabled: true,
    encryptionEnabled: true,
    retentionDays: 90,
    scheduleOptions: {
      frequency: ['daily', 'weekly', 'monthly'],
      allowedHours: [0, 2, 4, 6, 22] // Off-peak hours
    }
  });

  const updateConfig = (newConfig: Partial<BackupConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  };

  const { data: backups, isLoading: isLoadingBackups, refetch: refetchBackups } = useQuery({
    queryKey: ['backups', config],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: { 
          action: 'list_backups',
          config
        }
      });

      if (error) throw error;
      return data.backups;
    }
  });

  const createBackupMutation = useMutation({
    mutationFn: async (options: BackupOptions) => {
      setIsCreatingBackup(true);
      
      const validTables = options.tables?.filter(table => 
        config.availableTables.includes(table)
      ) || config.availableTables;
      
      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'create_backup',
          tables: validTables,
          backup_type: options.backup_type || 'full',
          config: {
            compression: config.compressionEnabled,
            encryption: config.encryptionEnabled,
            max_backups: config.maxBackupsToKeep
          }
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
      const validTables = options.tables_to_restore?.filter(table => 
        config.availableTables.includes(table)
      );

      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'restore_backup',
          ...options,
          tables_to_restore: validTables,
          config
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
      hour?: number;
    }) => {
      if (!config.scheduleOptions.frequency.includes(scheduleData.frequency)) {
        throw new Error(`Frequency ${scheduleData.frequency} is not allowed`);
      }

      if (scheduleData.hour !== undefined && !config.scheduleOptions.allowedHours.includes(scheduleData.hour)) {
        throw new Error(`Hour ${scheduleData.hour} is not in allowed schedule hours`);
      }

      const validTables = scheduleData.tables?.filter(table => 
        config.availableTables.includes(table)
      ) || config.availableTables;

      const { data, error } = await supabase.functions.invoke('data-backup', {
        body: {
          action: 'schedule_backup',
          ...scheduleData,
          tables: validTables,
          config
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

  const cleanupOldBackups = async () => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);
    
    return supabase.functions.invoke('data-backup', {
      body: {
        action: 'cleanup_old_backups',
        cutoff_date: cutoffDate.toISOString(),
        max_backups: config.maxBackupsToKeep,
        config
      }
    });
  };

  const getBackupStats = () => ({
    totalTables: config.availableTables.length,
    retentionDays: config.retentionDays,
    maxBackups: config.maxBackupsToKeep,
    features: {
      compression: config.compressionEnabled,
      encryption: config.encryptionEnabled
    }
  });

  return {
    backups,
    isLoadingBackups,
    config,
    updateConfig,
    createBackup: createBackupMutation.mutate,
    restoreBackup: restoreBackupMutation.mutate,
    scheduleBackup: scheduleBackupMutation.mutate,
    isCreatingBackup: isCreatingBackup || createBackupMutation.isPending,
    isRestoringBackup: restoreBackupMutation.isPending,
    isSchedulingBackup: scheduleBackupMutation.isPending,
    refetchBackups,
    cleanupOldBackups,
    getBackupStats,
    getAvailableTables: () => config.availableTables,
    getScheduleOptions: () => config.scheduleOptions
  };
};
