import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDisputes, Dispute, DisputeStatus } from '@/hooks/useDisputes';
import { DisputeDetail } from './DisputeDetail';
import { AlertCircle, Clock, CheckCircle, XCircle, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const statusConfig: Record<DisputeStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  under_review: { label: 'Under Review', variant: 'default', icon: <AlertCircle className="h-3 w-3" /> },
  resolved: { label: 'Resolved', variant: 'outline', icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: 'Rejected', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  escalated: { label: 'Escalated', variant: 'default', icon: <ArrowUpCircle className="h-3 w-3" /> },
};

const disputeTypeLabels: Record<string, string> = {
  unauthorized: 'Unauthorized Transaction',
  duplicate: 'Duplicate Charge',
  incorrect_amount: 'Incorrect Amount',
  service_not_received: 'Service Not Received',
  other: 'Other',
};

export const DisputeList = () => {
  const { disputes, isLoading } = useDisputes();
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Disputes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (disputes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Disputes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No Disputes</h3>
            <p className="text-muted-foreground text-sm">
              You haven't filed any transaction disputes yet.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (selectedDispute) {
    return (
      <DisputeDetail
        dispute={selectedDispute}
        onBack={() => setSelectedDispute(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Disputes ({disputes.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {disputes.map((dispute) => {
            const config = statusConfig[dispute.status];
            return (
              <button
                key={dispute.id}
                onClick={() => setSelectedDispute(dispute)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={config.variant} className="flex items-center gap-1">
                      {config.icon}
                      {config.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(dispute.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="font-medium truncate">{disputeTypeLabels[dispute.dispute_type]}</p>
                  <p className="text-sm text-muted-foreground truncate">{dispute.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-4" />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
