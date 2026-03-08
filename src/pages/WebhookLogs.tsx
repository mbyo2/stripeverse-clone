import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWebhookRetries } from '@/hooks/useWebhookRetries';
import { useBusinessData } from '@/hooks/useBusinessData';
import { RefreshCw, CheckCircle, XCircle, Clock, Zap, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

const WebhookLogs = () => {
  const { merchantAccount } = useBusinessData();
  const { logs, isLoading, retryWebhook, stats } = useWebhookRetries(merchantAccount?.id);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl mt-14">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-6 w-6" />Webhook Delivery Logs</h1>
          <p className="text-muted-foreground">Monitor webhook deliveries with automatic exponential backoff retries</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Events', value: stats.total, color: 'text-foreground' },
            { label: 'Delivered', value: stats.success, color: 'text-green-500' },
            { label: 'Failed', value: stats.failed, color: 'text-destructive' },
            { label: 'Pending', value: stats.pending, color: 'text-yellow-500' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-6 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Retry Info */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Exponential Backoff Retry Policy</p>
                <p className="text-muted-foreground">Failed webhooks are retried up to 5 times with increasing delays: 1s → 2s → 4s → 8s → 16s. After all retries fail, the event is marked as failed and can be manually retried.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12">
                <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-2">No Webhook Events</h3>
                <p className="text-muted-foreground text-sm">Events will appear here when webhooks are triggered.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell>{statusIcon(log.status)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{log.event_type}</Badge></TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]">{log.webhook_url}</TableCell>
                      <TableCell>{log.attempts}/{log.max_attempts}</TableCell>
                      <TableCell>
                        {log.response_status ? (
                          <Badge variant={log.response_status < 400 ? 'default' : 'destructive'}>{log.response_status}</Badge>
                        ) : log.error_message ? (
                          <span className="text-xs text-destructive truncate max-w-[150px] block">{log.error_message}</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                      </TableCell>
                      <TableCell>
                        {log.status === 'failed' && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => retryWebhook.mutate(log.id)}
                            disabled={retryWebhook.isPending}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default WebhookLogs;
