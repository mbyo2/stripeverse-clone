import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Download, FileText, TrendingUp, DollarSign, ArrowDownUp, AlertTriangle } from 'lucide-react';

const Settlements = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('all');

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['settlements', user?.id, period],
    queryFn: async () => {
      let query = supabase
        .from('settlement_reports')
        .select('*')
        .eq('merchant_id', user!.id)
        .order('period_end', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const totals = settlements.reduce((acc, s) => ({
    gross: acc.gross + Number(s.gross_amount),
    fees: acc.fees + Number(s.total_fees),
    net: acc.net + Number(s.net_amount),
    refunds: acc.refunds + Number(s.refunds_amount),
  }), { gross: 0, fees: 0, net: 0, refunds: 0 });

  const statusVariant = (s: string) => {
    switch (s) {
      case 'settled': return 'default';
      case 'pending': return 'secondary';
      case 'processing': return 'outline';
      default: return 'destructive';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl mt-14">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Settlement Reports</h1>
            <p className="text-muted-foreground">Track payouts and reconcile transactions</p>
          </div>
          <div className="flex gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export CSV</Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Gross Volume', value: totals.gross, icon: TrendingUp, color: 'text-green-500' },
            { label: 'Total Fees', value: totals.fees, icon: ArrowDownUp, color: 'text-orange-500' },
            { label: 'Net Settlements', value: totals.net, icon: DollarSign, color: 'text-primary' },
            { label: 'Refunds & Chargebacks', value: totals.refunds, icon: AlertTriangle, color: 'text-destructive' },
          ].map(item => (
            <Card key={item.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    <p className="text-2xl font-bold">K{item.value.toLocaleString('en', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <item.icon className={`h-8 w-8 ${item.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Settlements Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Settlement History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : settlements.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-2">No Settlements Yet</h3>
                <p className="text-muted-foreground text-sm">Settlements will appear here after processing transactions.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Transactions</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Fees</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payout Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">
                        {format(new Date(s.period_start), 'MMM d')} – {format(new Date(s.period_end), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>{s.total_transactions}</TableCell>
                      <TableCell>K{Number(s.gross_amount).toFixed(2)}</TableCell>
                      <TableCell className="text-orange-500">-K{Number(s.total_fees).toFixed(2)}</TableCell>
                      <TableCell className="font-medium">K{Number(s.net_amount).toFixed(2)}</TableCell>
                      <TableCell><Badge variant={statusVariant(s.status)}>{s.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.payout_reference || '—'}</TableCell>
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

export default Settlements;
