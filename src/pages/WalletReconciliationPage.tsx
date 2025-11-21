import { useEffect } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { WalletReconciliation } from '@/components/wallet/WalletReconciliation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WalletReconciliationPage() {
  useEffect(() => {
    document.title = "Wallet Reconciliation | Balance Verification";
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-3xl font-bold mb-2">Wallet Reconciliation</h1>
            <p className="text-muted-foreground">
              Verify and maintain accurate wallet balances
            </p>
          </div>

          {/* Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                How Balance Reconciliation Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h3 className="font-semibold">What is reconciliation?</h3>
                  <p className="text-sm text-muted-foreground">
                    Reconciliation compares your recorded wallet balance against the calculated 
                    balance from all completed transactions. This ensures accuracy and helps detect 
                    any discrepancies.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <h3 className="font-semibold">When to reconcile?</h3>
                  <p className="text-sm text-muted-foreground">
                    We recommend reconciling your wallet:
                  </p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                    <li>After making large transactions</li>
                    <li>Monthly for regular account maintenance</li>
                    <li>If you notice unexpected balance changes</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold">What causes discrepancies?</h3>
                  <p className="text-sm text-muted-foreground">
                    Common causes include pending transactions, system errors, or failed transaction 
                    reversals. All discrepancies are logged for security review.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Security & Audit
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    All reconciliation activities are logged and monitored. Balance corrections 
                    require verification and are permanently recorded in the audit trail.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main Reconciliation Component */}
          <WalletReconciliation />

          {/* Security Notice */}
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              All balance corrections are logged for security purposes and reviewed by our compliance team.
              If you notice repeated discrepancies, please contact support.
            </AlertDescription>
          </Alert>
        </div>
      </main>

      <Footer />
    </div>
  );
}