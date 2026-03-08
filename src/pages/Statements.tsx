import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV, exportToPDF } from '@/utils/exportUtils';
import { FileDown, FileText, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

const Statements = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('1');
  const [loading, setLoading] = useState(false);

  const fetchTransactions = async () => {
    const start = startOfMonth(subMonths(new Date(), Number(period)));
    const end = endOfMonth(new Date());
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user!.id)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  const handleExport = async (type: 'csv' | 'pdf') => {
    setLoading(true);
    try {
      const data = await fetchTransactions();
      if (!data.length) { toast.error('No transactions found'); return; }
      const rows = data.map(t => ({
        Date: format(new Date(t.created_at!), 'yyyy-MM-dd HH:mm'),
        Description: t.description || t.recipient_name || '-',
        Direction: t.direction,
        Amount: t.amount,
        Currency: t.currency,
        Fee: t.fee_amount || 0,
        Status: t.status,
        Reference: t.reference || '-',
        Category: t.category || '-',
      }));
      if (type === 'csv') {
        exportToCSV(rows, 'BMaGlassPay_Statement');
      } else {
        exportToPDF('Account Statement', rows, ['Date', 'Description', 'Direction', 'Amount', 'Currency', 'Fee', 'Status', 'Reference']);
      }
      toast.success(`${type.toUpperCase()} exported`);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Export Statements</h1>
        <p className="text-muted-foreground mb-6">Download your transaction history as CSV or PDF</p>

        <Card>
          <CardHeader><CardTitle>Generate Statement</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label>Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last Month</SelectItem>
                  <SelectItem value="3">Last 3 Months</SelectItem>
                  <SelectItem value="6">Last 6 Months</SelectItem>
                  <SelectItem value="12">Last 12 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Button onClick={() => handleExport('csv')} disabled={loading} variant="outline" className="h-20 flex-col gap-2">
                <FileSpreadsheet className="h-6 w-6" />
                <span>Export CSV</span>
              </Button>
              <Button onClick={() => handleExport('pdf')} disabled={loading} variant="outline" className="h-20 flex-col gap-2">
                <FileText className="h-6 w-6" />
                <span>Export PDF</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Statements;
