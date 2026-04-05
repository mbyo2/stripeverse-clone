import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuditLogs } from "@/hooks/useAuditLogs";
import { ScrollText, Download, Filter, RefreshCw, Shield } from "lucide-react";
import { format } from "date-fns";
import PageSkeleton from "@/components/PageSkeleton";
import PageErrorState from "@/components/PageErrorState";
import EmptyState from "@/components/ui/empty-state";

const AuditLogs = () => {
  const {
    auditLogs, isLoading, error, filters, setFilters,
    generateReport, isGeneratingReport, getAvailableFilters
  } = useAuditLogs();

  const available = getAvailableFilters();

  const actionColor = (action: string) => {
    switch (action) {
      case "INSERT": return "bg-success/10 text-success";
      case "UPDATE": return "bg-warning/10 text-warning";
      case "DELETE": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (isLoading) return <PageSkeleton cards={4} showChart={false} />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <ScrollText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
              <p className="text-sm text-muted-foreground">Track all system changes and user actions</p>
            </div>
          </div>
          <Button
            onClick={() => generateReport({ filters, format: "csv" })}
            disabled={isGeneratingReport}
            variant="outline"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export Report
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-3">
              <Select
                value={filters.action || "all"}
                onValueChange={(v) => setFilters({ ...filters, action: v === "all" ? undefined : v })}
              >
                <SelectTrigger className="w-36"><SelectValue placeholder="Action" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {available.actions.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.table_name || "all"}
                onValueChange={(v) => setFilters({ ...filters, table_name: v === "all" ? undefined : v })}
              >
                <SelectTrigger className="w-44"><SelectValue placeholder="Table" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tables</SelectItem>
                  {available.tables.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                className="w-40"
                value={filters.start_date || ""}
                onChange={(e) => setFilters({ ...filters, start_date: e.target.value || undefined })}
                placeholder="Start date"
              />
              <Input
                type="date"
                className="w-40"
                value={filters.end_date || ""}
                onChange={(e) => setFilters({ ...filters, end_date: e.target.value || undefined })}
                placeholder="End date"
              />
            </div>
          </CardContent>
        </Card>

        {error ? (
          <PageErrorState onRetry={() => setFilters({ ...filters })} />
        ) : !auditLogs || auditLogs.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<ScrollText className="h-12 w-12" />}
                title="No audit logs found"
                description="Audit logs will appear here as system changes occur."
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Log Entries</CardTitle>
              <CardDescription>{auditLogs.length} records</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {auditLogs.map((log: any) => (
                  <div key={log.id} className="px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${actionColor(log.action)}`}>{log.action}</Badge>
                        <span className="text-sm font-medium">{log.table_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), "MMM d, yyyy HH:mm:ss")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Record: {log.record_id.substring(0, 8)}...
                      {log.profiles && ` · By: ${log.profiles.first_name || ""} ${log.profiles.last_name || ""}`}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AuditLogs;
