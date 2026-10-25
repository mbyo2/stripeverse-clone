import Header from '@/components/Header';
import { Skeleton } from "@/components/ui/skeleton";
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useBnpl } from '@/hooks/useBnpl';
import { useCurrency } from '@/contexts/CurrencyContext';
import { CalendarClock, CreditCard, Clock, CheckCircle2, AlertTriangle, Zap, ZapOff, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const BuyNowPayLater = () => {
  const { plans, activePlans, totalOwed, isLoading, autoDebitByPlan, payInstallment, enableAutoDebit, disableAutoDebit } = useBnpl();
  const { formatAmount } = useCurrency();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'overdue': return <Badge className="bg-red-500/10 text-red-600"><AlertTriangle className="h-3 w-3 mr-1" />Overdue</Badge>;
      default: return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Active</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Pay in 4</h1>
          <p className="text-muted-foreground">Split purchases into 4 interest-free installments</p>
        </div>

        {/* How it Works */}
        <Card className="mb-8 bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <h3 className="font-bold text-lg mb-4">How Pay in 4 Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {[
                { step: '1', title: 'Shop', desc: 'Choose Pay in 4 at checkout' },
                { step: '2', title: 'Pay 25%', desc: 'First payment due today' },
                { step: '3', title: 'Automatic', desc: 'Every 2 weeks, 25% more' },
                { step: '4', title: 'Done!', desc: 'Paid off in 6 weeks' },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-2 font-bold">
                    {s.step}
                  </div>
                  <p className="font-medium text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><CreditCard className="h-5 w-5 text-blue-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Active Plans</p>
                <p className="text-xl font-bold">{activePlans.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><CalendarClock className="h-5 w-5 text-amber-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Total Owed</p>
                <p className="text-xl font-bold">{formatAmount(totalOwed)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><CheckCircle2 className="h-5 w-5 text-green-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-xl font-bold">{plans.filter((p) => p.status === 'completed').length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plans */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-24" /></CardContent></Card>
            ))}
          </div>
        ) : plans.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <CreditCard className="h-16 w-16 mx-auto mb-4 opacity-40" />
              <h3 className="font-semibold text-lg mb-2">No Pay in 4 Plans</h3>
              <p className="mb-4">Choose "Pay in 4" at checkout to split your next purchase into interest-free installments</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => {
              const progress = (plan.installments_paid / plan.installments_total) * 100;
              const remaining = (plan.installments_total - plan.installments_paid) * plan.installment_amount;
              return (
                <Card key={plan.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-bold text-lg">{plan.merchant_name || 'Purchase'}</span>
                          {getStatusBadge(plan.status)}
                        </div>
                        {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          Started {format(new Date(plan.created_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{formatAmount(plan.total_amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatAmount(plan.installment_amount)} × {plan.installments_total}
                        </p>
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span>{plan.installments_paid} of {plan.installments_total} paid</span>
                        <span className="text-muted-foreground">{formatAmount(remaining)} remaining</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>

                    <div className="flex gap-2">
                      {Array.from({ length: plan.installments_total }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`flex-1 h-2 rounded-full ${
                            idx < plan.installments_paid ? 'bg-green-500' : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>

                    {plan.next_payment_date && plan.status === 'active' && (
                      <p className="text-sm mt-3 text-muted-foreground">
                        Next payment: {formatAmount(plan.installment_amount)} on {format(new Date(plan.next_payment_date), 'MMM d, yyyy')}
                      </p>
                    )}

                    {plan.status === 'active' && (
                      <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t">
                        <Button
                          onClick={() => payInstallment.mutate(plan)}
                          disabled={payInstallment.isPending}
                          size="sm"
                        >
                          {payInstallment.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CreditCard className="h-4 w-4 mr-2" />
                          )}
                          Pay {formatAmount(plan.installment_amount)} now
                        </Button>
                        <div className="flex items-center gap-2">
                          {autoDebitByPlan[plan.id] ? (
                            <Zap className="h-4 w-4 text-green-600" />
                          ) : (
                            <ZapOff className="h-4 w-4 text-muted-foreground" />
                          )}
                          <Label htmlFor={`autodebit-${plan.id}`} className="text-sm cursor-pointer">
                            Auto-debit installments
                          </Label>
                          <Switch
                            id={`autodebit-${plan.id}`}
                            checked={!!autoDebitByPlan[plan.id] && autoDebitByPlan[plan.id].status === 'active'}
                            onCheckedChange={(on) => {
                              if (on) enableAutoDebit.mutate(plan);
                              else disableAutoDebit.mutate(plan.id);
                            }}
                            disabled={enableAutoDebit.isPending || disableAutoDebit.isPending}
                          />
                        </div>
                        {autoDebitByPlan[plan.id] && autoDebitByPlan[plan.id].status === 'paused' && (
                          <span className="text-xs text-amber-600">
                            Auto-debit paused (check wallet balance)
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BuyNowPayLater;
