
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNativeBilling } from '@/hooks/useNativeBilling';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Download, FileText, Receipt } from "lucide-react";

const BillingHistory = () => {
  const { invoices, invoicesLoading } = useNativeBilling();
  const { formatAmount } = useCurrency();

  if (invoicesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No billing history yet</p>
            <p className="text-sm text-muted-foreground mt-1">Invoices will appear here after your first billing cycle</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge variant="default" className="bg-green-500">Paid</Badge>;
      case 'pending': return <Badge variant="secondary">Pending</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      case 'refunded': return <Badge variant="outline">Refunded</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Summary stats
  const totalPaid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);
  const pendingAmount = invoices
    .filter(i => i.status === 'pending')
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-2xl font-bold">{formatAmount(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold">{formatAmount(pendingAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Invoices</p>
            <p className="text-2xl font-bold">{invoices.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Invoice List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Billing History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium capitalize">{invoice.subscription_tier} Plan</span>
                    {getStatusBadge(invoice.status)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(invoice.billing_period_start).toLocaleDateString()} –{' '}
                    {new Date(invoice.billing_period_end).toLocaleDateString()}
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-medium">{formatAmount(invoice.amount)}</div>
                    <div className="text-xs text-muted-foreground uppercase">{invoice.currency}</div>
                  </div>
                  
                  {invoice.invoice_url && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open(invoice.invoice_url!, '_blank')}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BillingHistory;
