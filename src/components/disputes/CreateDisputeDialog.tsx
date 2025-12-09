import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDisputes, DisputeType } from '@/hooks/useDisputes';
import { AlertCircle } from 'lucide-react';

interface CreateDisputeDialogProps {
  transactionId: string;
  transactionAmount: number;
  transactionDate: string;
  trigger?: React.ReactNode;
}

const disputeTypes: { value: DisputeType; label: string; description: string }[] = [
  { value: 'unauthorized', label: 'Unauthorized Transaction', description: 'I did not authorize this transaction' },
  { value: 'duplicate', label: 'Duplicate Charge', description: 'I was charged multiple times for the same transaction' },
  { value: 'incorrect_amount', label: 'Incorrect Amount', description: 'The charged amount differs from what I expected' },
  { value: 'service_not_received', label: 'Service Not Received', description: 'I paid but did not receive the goods or service' },
  { value: 'other', label: 'Other', description: 'Another issue not listed above' },
];

export const CreateDisputeDialog = ({
  transactionId,
  transactionAmount,
  transactionDate,
  trigger,
}: CreateDisputeDialogProps) => {
  const [open, setOpen] = useState(false);
  const [disputeType, setDisputeType] = useState<DisputeType | ''>('');
  const [description, setDescription] = useState('');
  const { createDispute, isCreating } = useDisputes();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeType || !description.trim()) return;

    createDispute(
      {
        transaction_id: transactionId,
        dispute_type: disputeType,
        description: description.trim(),
      },
      {
        onSuccess: () => {
          setOpen(false);
          setDisputeType('');
          setDescription('');
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="text-destructive border-destructive hover:bg-destructive/10">
            <AlertCircle className="h-4 w-4 mr-2" />
            Dispute
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Dispute</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="text-muted-foreground">Transaction Details:</p>
            <p className="font-medium">Amount: K{transactionAmount.toFixed(2)}</p>
            <p className="text-muted-foreground">{new Date(transactionDate).toLocaleDateString()}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dispute-type">Dispute Reason</Label>
            <Select value={disputeType} onValueChange={(v) => setDisputeType(v as DisputeType)}>
              <SelectTrigger id="dispute-type">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {disputeTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex flex-col">
                      <span>{type.label}</span>
                      <span className="text-xs text-muted-foreground">{type.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please provide details about your dispute..."
              rows={4}
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !disputeType || !description.trim()}>
              {isCreating ? 'Submitting...' : 'Submit Dispute'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
