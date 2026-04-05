import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useBackupManager } from "@/hooks/useBackupManager";
import { Database, Download, RefreshCw, Shield, Clock, HardDrive } from "lucide-react";
import { useState } from "react";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/ui/empty-state";

const BackupExport = () => {
  const {
    backups, isLoadingBackups, config, createBackup, isCreatingBackup,
    getAvailableTables, getBackupStats
  } = useBackupManager();

  const [selectedTables, setSelectedTables] = useState<string[]>(config.availableTables);
  const stats = getBackupStats();

  const toggleTable = (table: string) => {
    setSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    );
  };

  if (isLoadingBackups) return <PageSkeleton cards={3} />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Backup & Export</h1>
            <p className="text-sm text-muted-foreground">Create backups and export your data</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <HardDrive className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tables</p>
                <p className="text-xl font-bold">{stats.totalTables}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Encryption</p>
                <p className="text-xl font-bold">{stats.features.encryption ? "Enabled" : "Off"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Retention</p>
                <p className="text-xl font-bold">{stats.retentionDays} days</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Create Backup */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Create Backup</CardTitle>
            <CardDescription>Select tables to include in the backup</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {getAvailableTables().map((table) => (
                <label key={table} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                  <Checkbox
                    checked={selectedTables.includes(table)}
                    onCheckedChange={() => toggleTable(table)}
                  />
                  <span className="text-sm font-medium">{table.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => createBackup({ tables: selectedTables, backup_type: "full" })}
                disabled={isCreatingBackup || selectedTables.length === 0}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {isCreatingBackup ? "Creating..." : "Full Backup"}
              </Button>
              <Button
                variant="outline"
                onClick={() => createBackup({ tables: selectedTables, backup_type: "incremental" })}
                disabled={isCreatingBackup || selectedTables.length === 0}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Incremental
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Backup History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Backup History</CardTitle>
          </CardHeader>
          <CardContent>
            {!backups || backups.length === 0 ? (
              <EmptyState
                icon={<Database className="h-12 w-12" />}
                title="No backups yet"
                description="Create your first backup to secure your data."
              />
            ) : (
              <div className="divide-y divide-border">
                {backups.map((backup: any) => (
                  <div key={backup.backup_id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{backup.backup_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {backup.total_records} records · {backup.backup_type}
                      </p>
                    </div>
                    <Badge variant="secondary">{backup.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default BackupExport;
