import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { DisputeList } from '@/components/disputes/DisputeList';
import { CreateDisputeDialog } from '@/components/disputes/CreateDisputeDialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { useDisputes } from '@/hooks/useDisputes';
import { Plus, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';

const Disputes = () => {
  const [createOpen, setCreateOpen] = useState(false);
  const { disputes } = useDisputes();

  const stats = {
    total: disputes.length,
    pending: disputes.filter(d => d.status === 'pending' || d.status === 'under_review').length,
    resolved: disputes.filter(d => d.status === 'resolved').length,
    rejected: disputes.filter(d => d.status === 'rejected').length,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl mt-14">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Chargebacks & Disputes</h1>
            <p className="text-muted-foreground">Manage transaction disputes and chargebacks</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />New Dispute</Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, icon: AlertCircle, color: 'text-foreground' },
            { label: 'Open', value: stats.pending, icon: Clock, color: 'text-yellow-500' },
            { label: 'Resolved', value: stats.resolved, icon: CheckCircle, color: 'text-green-500' },
            { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'text-destructive' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <s.icon className={`h-5 w-5 ${s.color}`} />
                <div>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <DisputeList />
        <CreateDisputeDialog open={createOpen} onOpenChange={setCreateOpen} />
      </main>
      <Footer />
    </div>
  );
};

export default Disputes;
