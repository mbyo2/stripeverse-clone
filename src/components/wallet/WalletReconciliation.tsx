import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useWallet } from '@/hooks/useWallet';
import { useWalletReconciliation } from '@/hooks/useWalletReconciliation';
import { formatCurrency } from '@/lib/utils';
import { 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp,
  TrendingDown,
  Clock,
  FileText
} from 'lucide-react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export const WalletReconciliation = () => {
  const { wallet } = useWallet();
  const { 
    reconciliations, 
    isLoading, 
    reconcileWallet, 
    fixBalance,
    isReconciling,
    isFixing
  } = useWalletReconciliation();

  const [showFixDialog, setShowFixDialog] = useState(false);
  const [fixNotes, setFixNotes] = useState('');

  const latestReconciliation = reconciliations[0];
  const hasDiscrepancy = latestReconciliation && Math.abs(latestReconciliation.difference) > 0.01;

  const handleReconcile = () => {
    if (!wallet?.id) return;
    reconcileWallet({ 
      walletId: wallet.id,
      notes: 'User-initiated balance check'
    });
  };

  const handleFixBalance = () => {
    if (!wallet?.id) return;
    fixBalance({ 
      walletId: wallet.id,
      notes: fixNotes || 'Balance correction applied'
    });
    setShowFixDialog(false);
    setFixNotes('');
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5" />
                Balance Reconciliation
              </CardTitle>
              <CardDescription>
                Verify wallet balance against transaction history
              </CardDescription>
            </div>
            <Button 
              onClick={handleReconcile}
              disabled={isReconciling || !wallet?.id}
              variant="outline"
            >
              {isReconciling && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Check Balance
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestReconciliation ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Recorded Balance</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(latestReconciliation.recorded_balance)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Calculated Balance</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(latestReconciliation.calculated_balance)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Difference</p>
                  <div className="flex items-center gap-2">
                    <p className={`text-2xl font-bold ${
                      hasDiscrepancy 
                        ? 'text-destructive' 
                        : 'text-green-500'
                    }`}>
                      {latestReconciliation.difference > 0 ? '+' : ''}
                      {formatCurrency(latestReconciliation.difference)}
                    </p>
                    {latestReconciliation.difference > 0 ? (
                      <TrendingUp className="w-5 h-5 text-destructive" />
                    ) : latestReconciliation.difference < 0 ? (
                      <TrendingDown className="w-5 h-5 text-destructive" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  Last checked: {format(new Date(latestReconciliation.created_at), 'PPp')}
                </div>
                <div className="text-muted-foreground">
                  {latestReconciliation.transaction_count} transactions analyzed
                </div>
              </div>

              {hasDiscrepancy && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>
                      Balance discrepancy detected! The recorded balance doesn't match transaction history.
                    </span>
                    <Button 
                      size="sm"
                      variant="outline"
                      onClick={() => setShowFixDialog(true)}
                      disabled={isFixing}
                    >
                      {isFixing ? 'Fixing...' : 'Fix Balance'}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {!hasDiscrepancy && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Balance is accurate. No discrepancies detected.
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                No reconciliation data available. Click "Check Balance" to verify your wallet balance.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation History */}
      {reconciliations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation History</CardTitle>
            <CardDescription>
              Recent balance verification records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Recorded</TableHead>
                  <TableHead className="text-right">Calculated</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliations.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="text-sm">
                      {format(new Date(record.created_at), 'PPp')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {record.reconciliation_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(record.recorded_balance)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(record.calculated_balance)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${
                      Math.abs(record.difference) > 0.01 
                        ? 'text-destructive font-semibold' 
                        : 'text-green-500'
                    }`}>
                      {record.difference > 0 ? '+' : ''}
                      {formatCurrency(record.difference)}
                    </TableCell>
                    <TableCell>
                      {Math.abs(record.difference) > 0.01 ? (
                        <Badge variant="destructive">Discrepancy</Badge>
                      ) : (
                        <Badge variant="default">Balanced</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Fix Balance Dialog */}
      <Dialog open={showFixDialog} onOpenChange={setShowFixDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fix Wallet Balance</DialogTitle>
            <DialogDescription>
              This will update your wallet balance to match the calculated amount from your transaction history.
              This action will be logged for audit purposes.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {latestReconciliation && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Your balance will be changed from{' '}
                  <strong>{formatCurrency(latestReconciliation.recorded_balance)}</strong>
                  {' '}to{' '}
                  <strong>{formatCurrency(latestReconciliation.calculated_balance)}</strong>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="fix-notes">Notes (Optional)</Label>
              <Textarea
                id="fix-notes"
                placeholder="Reason for balance correction..."
                value={fixNotes}
                onChange={(e) => setFixNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowFixDialog(false)}
              disabled={isFixing}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleFixBalance}
              disabled={isFixing}
            >
              {isFixing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Fix
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};