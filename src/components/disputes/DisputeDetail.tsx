import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dispute, DisputeStatus, useDisputeMessages } from '@/hooks/useDisputes';
import { ArrowLeft, Send, Clock, CheckCircle, XCircle, AlertCircle, ArrowUpCircle } from 'lucide-react';
import { format } from 'date-fns';

interface DisputeDetailProps {
  dispute: Dispute;
  onBack: () => void;
}

const statusConfig: Record<DisputeStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; description: string }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-4 w-4" />, description: 'Your dispute is awaiting review.' },
  under_review: { label: 'Under Review', variant: 'default', icon: <AlertCircle className="h-4 w-4" />, description: 'Our team is reviewing your dispute.' },
  resolved: { label: 'Resolved', variant: 'outline', icon: <CheckCircle className="h-4 w-4" />, description: 'This dispute has been resolved.' },
  rejected: { label: 'Rejected', variant: 'destructive', icon: <XCircle className="h-4 w-4" />, description: 'This dispute was rejected.' },
  escalated: { label: 'Escalated', variant: 'default', icon: <ArrowUpCircle className="h-4 w-4" />, description: 'This dispute has been escalated for further review.' },
};

const disputeTypeLabels: Record<string, string> = {
  unauthorized: 'Unauthorized Transaction',
  duplicate: 'Duplicate Charge',
  incorrect_amount: 'Incorrect Amount',
  service_not_received: 'Service Not Received',
  other: 'Other',
};

export const DisputeDetail = ({ dispute, onBack }: DisputeDetailProps) => {
  const [newMessage, setNewMessage] = useState('');
  const { messages, isLoading, sendMessage, isSending } = useDisputeMessages(dispute.id);
  const config = statusConfig[dispute.status];

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    sendMessage({ disputeId: dispute.id, message: newMessage.trim() });
    setNewMessage('');
  };

  const canSendMessage = dispute.status === 'pending' || dispute.status === 'under_review';

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Disputes
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{disputeTypeLabels[dispute.dispute_type]}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Created {format(new Date(dispute.created_at), 'PPP')}
              </p>
            </div>
            <Badge variant={config.variant} className="flex items-center gap-1">
              {config.icon}
              {config.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm font-medium mb-1">Status</p>
            <p className="text-sm text-muted-foreground">{config.description}</p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Description</p>
            <p className="text-sm text-muted-foreground">{dispute.description}</p>
          </div>

          {dispute.resolution_notes && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm font-medium mb-1">Resolution Notes</p>
              <p className="text-sm">{dispute.resolution_notes}</p>
              {dispute.refund_amount && (
                <p className="text-sm font-medium mt-2">
                  Refund Amount: K{dispute.refund_amount.toFixed(2)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No messages yet. Start a conversation about your dispute.
            </p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 ${
                    msg.sender_id === dispute.user_id
                      ? 'bg-primary/10 ml-8'
                      : 'bg-muted mr-8'
                  }`}
                >
                  <p className="text-sm">{msg.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(msg.created_at), 'PPp')}
                  </p>
                </div>
              ))}
            </div>
          )}

          {canSendMessage && (
            <div className="flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message..."
                rows={2}
                className="flex-1"
              />
              <Button
                onClick={handleSendMessage}
                disabled={isSending || !newMessage.trim()}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}

          {!canSendMessage && (
            <p className="text-sm text-muted-foreground text-center">
              This dispute is {dispute.status}. No further messages can be sent.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
