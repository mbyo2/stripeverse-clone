import { toUserFacingError } from "@/utils/userFacingError";
import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV, exportToPDF } from '@/utils/exportUtils';
import { transactionTitle } from '@/utils/transactionLabels';
import { Search, FileDown, Filter, Loader2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const TransactionSearch = () => {
  const { user } = useAuth();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ query: '', status: 'all', direction: 'all', dateFrom: '', dateTo: '', minAmount: '', maxAmount: '' });

  const handleSearch = async () => {
    if (!user) {
      toast.error('Your session is still loading. Please try again in a moment.');
      return;
    }
    setLoading(true);
    setHasSearched(true);
    setSearchError(null);
    try {
      let q = supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.direction !== 'all') q = q.eq('direction', filters.direction);
      if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
      if (filters.dateTo) q = q.lte('created_at', filters.dateTo + 'T23:59:59');
      if (filters.minAmount) q = q.gte('amount', Number(filters.minAmount));
      if (filters.maxAmount) q = q.lte('amount', Number(filters.maxAmount));
      // Strip characters that would break the PostgREST or-filter grammar
      // (commas, parentheses, quotes, wildcards) so any typed text is a
      // plain substring search instead of a failed query.
      const safeQuery = filters.query.replace(/[,()"*%\\]/g, '').trim();
      if (safeQuery) q = q.or(`description.ilike.%${safeQuery}%,recipient_name.ilike.%${safeQuery}%,reference.ilike.%${safeQuery}%`);
      const { data, error } = await q;
      if (error) throw error;
      setResults(data || []);
    } catch (e: any) {
      const message = toUserFacingError(e);
      setSearchError(message);
      toast.error(message);
    } finally { setLoading(false); }
  };

  const handleExport = (type: 'csv' | 'pdf') => {
    if (!results.length) return;
    const rows = results.map(t => ({
      Date: format(new Date(t.created_at), 'yyyy-MM-dd HH:mm'),
      Description: t.description || t.recipient_name || '-',
      Direction: t.direction, Amount: t.amount, Currency: t.currency, Status: t.status, Reference: t.reference || '-',
    }));
    type === 'csv' ? exportToCSV(rows, 'Transactions') : exportToPDF('Transaction Search Results', rows, ['Date', 'Description', 'Direction', 'Amount', 'Currency', 'Status', 'Reference']);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-2 pb-24 px-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6">Transaction Search</h1>
        <Card className="mb-6">
          <CardContent className="p-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-10" placeholder="Search by description, recipient, or reference..." value={filters.query} onChange={e => setFilters(p => ({ ...p, query: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">Status</Label>
                <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Direction</Label>
                <Select value={filters.direction} onValueChange={v => setFilters(p => ({ ...p, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="incoming">Incoming</SelectItem><SelectItem value="outgoing">Outgoing</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">From Date</Label><Input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} /></div>
              <div><Label className="text-xs">To Date</Label><Input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">Min Amount</Label><Input type="number" value={filters.minAmount} onChange={e => setFilters(p => ({ ...p, minAmount: e.target.value }))} /></div>
              <div><Label className="text-xs">Max Amount</Label><Input type="number" value={filters.maxAmount} onChange={e => setFilters(p => ({ ...p, maxAmount: e.target.value }))} /></div>
              <Button onClick={handleSearch} disabled={loading} className="self-end col-span-2">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Filter className="h-4 w-4 mr-2" />}
                {loading ? 'Searching…' : 'Search'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {!hasSearched && !loading && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <Search className="h-6 w-6 mx-auto mb-2" />
              <p className="text-sm">Search across all your transactions by description, recipient or reference — then press Search.</p>
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Searching your transactions…</span>
          </div>
        )}

        {!loading && searchError && (
          <Card>
            <CardContent className="p-6 text-center">
              <AlertCircle className="h-6 w-6 mx-auto mb-2 text-destructive" />
              <p className="text-sm font-medium text-foreground">We couldn't run that search</p>
              <p className="text-sm text-muted-foreground mt-1">{searchError}</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={handleSearch}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {!loading && !searchError && hasSearched && results.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <Search className="h-6 w-6 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No transactions found</p>
              <p className="text-sm mt-1">Nothing matches that search. Try a different term, or widen the dates and amounts.</p>
            </CardContent>
          </Card>
        )}

        {results.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{results.length} results</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleExport('csv')}><FileDown className="h-4 w-4 mr-1" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={() => handleExport('pdf')}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {results.map(t => (
            <Card key={t.uuid_id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{t.direction === 'incoming' ? transactionTitle(t) : (t.description || t.recipient_name || 'Transaction')}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), 'MMM d, yyyy HH:mm')} • {t.reference || '-'}</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold text-sm ${t.direction === 'incoming' ? 'text-success' : ''}`}>
                    {t.direction === 'incoming' ? '+' : '-'}{t.currency} {Number(t.amount).toLocaleString()}
                  </p>
                  <Badge variant={t.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{t.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default TransactionSearch;
