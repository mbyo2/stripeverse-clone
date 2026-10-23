import Header from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useBillPayments } from '@/hooks/useBillPayments';
import { Zap, Smartphone, Tv, Wifi, Droplets, Receipt, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const categoryIcons: Record<string, React.ElementType> = {
  electricity: Zap, airtime: Smartphone, tv: Tv, internet: Wifi, water: Droplets,
};

const BillPayments = () => {
  const { payments, billers } = useBillPayments();
  const categories = [...new Set(billers.map(b => b.category))];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">Bill Payments</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-6">Pay utilities, airtime, TV subscriptions and more</p>

        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Bill payments are not live yet</AlertTitle>
          <AlertDescription>
            No biller integration is connected, so payments are disabled and no money will be taken.
            You can browse the biller list and view your payment history below.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="pay">
          <TabsList><TabsTrigger value="pay">Pay Bills</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>

          <TabsContent value="pay" className="space-y-6 mt-4">
            {categories.map(cat => {
              const Icon = categoryIcons[cat] || Receipt;
              return (
                <div key={cat}>
                  <h3 className="font-semibold capitalize mb-3 flex items-center gap-2"><Icon className="h-4 w-4" /> {cat}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {billers.filter(b => b.category === cat).map(biller => (
                      <Card key={biller.code} className="opacity-70">
                        <CardContent className="p-4 text-center">
                          <span className="text-2xl mb-2 block">{biller.icon}</span>
                          <p className="font-medium text-sm">{biller.name}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {payments.data?.length ? (
              <Card>
                <CardContent className="px-6 py-2">
                  <div className="divide-y divide-border">
                    {payments.data?.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-4">
                        <div>
                          <p className="font-medium text-[15px]">{p.biller_name}</p>
                          <p className="text-[13px] text-muted-foreground">Acc: {p.account_number} • {p.reference}</p>
                          <p className="text-[13px] text-muted-foreground">{format(new Date(p.created_at), 'MMM d, yyyy HH:mm')}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">ZMW {Number(p.amount).toLocaleString()}</p>
                          <Badge variant={p.status === 'completed' ? 'default' : 'secondary'}>{p.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-center text-muted-foreground py-8">No bill payments yet</p>
            )}
          </TabsContent>
        </Tabs>

      </main>
    </div>
  );
};

export default BillPayments;
