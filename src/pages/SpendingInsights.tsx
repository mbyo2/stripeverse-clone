import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useBudgetGoals } from '@/hooks/useBudgetGoals';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line,
} from 'recharts';
import { TrendingDown, TrendingUp, PiggyBank, Target, Plus, Download, ArrowDownToLine, Wallet } from 'lucide-react';
import { format } from 'date-fns';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const SpendingInsights = () => {
  const { user } = useAuth();
  const { goals, budgets, goalsLoading, createGoal, addToGoal } = useBudgetGoals();
  const { formatAmount } = useCurrency();
  const [showGoalDialog, setShowGoalDialog] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);

  // Fetch spending data from Supabase
  const { data: categorySpending = [] } = useQuery({
    queryKey: ['spending-by-category', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_spending_by_category', { p_user_id: user!.id });
      if (error) throw error;
      return (data || []).map((item: any, idx: number) => ({
        ...item,
        color: COLORS[idx % COLORS.length],
      }));
    },
    enabled: !!user?.id,
  });

  const { data: monthlyData = [] } = useQuery({
    queryKey: ['monthly-transactions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_monthly_transaction_data', { p_user_id: user!.id });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: stats } = useQuery({
    queryKey: ['transaction-stats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_transaction_stats', { p_user_id: user!.id });
      if (error) throw error;
      return data?.[0] || { total_transactions: 0, monthly_amount: 0, monthly_transactions: 0 };
    },
    enabled: !!user?.id,
  });

  const totalSpending = categorySpending.reduce((sum: number, c: any) => sum + Number(c.amount), 0);

  const handleCreateGoal = async () => {
    if (!goalName || !goalTarget) return;
    await createGoal.mutateAsync({
      name: goalName,
      target_amount: parseFloat(goalTarget),
      deadline: goalDeadline || undefined,
    });
    setShowGoalDialog(false);
    setGoalName('');
    setGoalTarget('');
    setGoalDeadline('');
  };

  const handleAddToGoal = async (goalId: string) => {
    if (!addAmount || parseFloat(addAmount) <= 0) return;
    await addToGoal.mutateAsync({ id: goalId, amount: parseFloat(addAmount) });
    setAddAmount('');
    setSelectedGoal(null);
  };

  const exportCSV = () => {
    const headers = ['Category,Amount\n'];
    const rows = categorySpending.map((c: any) => `${c.category},${c.amount}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spending-report-${format(new Date(), 'yyyy-MM')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Spending Insights</h1>
            <p className="text-muted-foreground">Track your spending, set budgets, and save towards goals</p>
          </div>
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10"><Wallet className="h-5 w-5 text-blue-500" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">This Month</p>
                  <p className="text-xl font-bold">{formatAmount(stats?.monthly_amount || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10"><TrendingUp className="h-5 w-5 text-green-500" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <p className="text-xl font-bold">{stats?.monthly_transactions || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10"><Target className="h-5 w-5 text-purple-500" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Goals</p>
                  <p className="text-xl font-bold">{goals.filter(g => g.status === 'active').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10"><PiggyBank className="h-5 w-5 text-amber-500" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Saved</p>
                  <p className="text-xl font-bold">{formatAmount(goals.reduce((sum, g) => sum + g.current_amount, 0))}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="spending" className="space-y-6">
          <TabsList>
            <TabsTrigger value="spending">Spending</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="goals">Savings Goals</TabsTrigger>
          </TabsList>

          {/* Spending Tab */}
          <TabsContent value="spending">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Spending by Category</CardTitle>
                  <CardDescription>This month's breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  {categorySpending.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={categorySpending}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="amount"
                          label={({ category, percent }: any) => `${category} ${(percent * 100).toFixed(0)}%`}
                        >
                          {categorySpending.map((entry: any, idx: number) => (
                            <Cell key={idx} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val: number) => formatAmount(val)} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No spending data yet
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Category Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {categorySpending.length > 0 ? categorySpending.map((cat: any, idx: number) => (
                      <div key={idx}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{cat.category}</span>
                          <span>{formatAmount(cat.amount)}</span>
                        </div>
                        <Progress
                          value={totalSpending > 0 ? (cat.amount / totalSpending) * 100 : 0}
                          className="h-2"
                        />
                      </div>
                    )) : (
                      <p className="text-muted-foreground text-center py-8">No spending data yet</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Trends Tab */}
          <TabsContent value="trends">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>Monthly Spending</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(val: number) => formatAmount(val)} />
                      <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Transaction Volume</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="transaction_count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Goals Tab */}
          <TabsContent value="goals">
            <div className="flex justify-end mb-4">
              <Dialog open={showGoalDialog} onOpenChange={setShowGoalDialog}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-2" />New Goal</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Savings Goal</DialogTitle>
                    <DialogDescription>Set a target and save towards it</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Goal Name</Label>
                      <Input placeholder="e.g., Emergency Fund" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Target Amount (ZMW)</Label>
                      <Input type="number" placeholder="0.00" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Deadline (optional)</Label>
                      <Input type="date" value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowGoalDialog(false)}>Cancel</Button>
                    <Button onClick={handleCreateGoal} disabled={createGoal.isPending}>Create Goal</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {goalsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse"><CardContent className="p-6"><div className="h-32 bg-muted rounded" /></CardContent></Card>
                ))}
              </div>
            ) : goals.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  <PiggyBank className="h-16 w-16 mx-auto mb-4 opacity-40" />
                  <h3 className="font-semibold text-lg mb-2">No savings goals yet</h3>
                  <p className="mb-4">Start saving by creating your first goal</p>
                  <Button onClick={() => setShowGoalDialog(true)}>Create Your First Goal</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {goals.map((goal) => {
                  const progress = goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0;
                  return (
                    <Card key={goal.id} className="hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{goal.name}</CardTitle>
                          {goal.status === 'completed' ? (
                            <Badge className="bg-green-500/10 text-green-600">Complete!</Badge>
                          ) : (
                            <Badge variant="outline">{Math.round(progress)}%</Badge>
                          )}
                        </div>
                        {goal.deadline && (
                          <CardDescription>Due: {format(new Date(goal.deadline), 'MMM d, yyyy')}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="mb-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span>{formatAmount(goal.current_amount)}</span>
                            <span className="text-muted-foreground">{formatAmount(goal.target_amount)}</span>
                          </div>
                          <Progress value={Math.min(progress, 100)} className="h-3" />
                        </div>
                        {goal.status === 'active' && (
                          selectedGoal === goal.id ? (
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                placeholder="Amount"
                                value={addAmount}
                                onChange={(e) => setAddAmount(e.target.value)}
                                className="flex-1"
                              />
                              <Button size="sm" onClick={() => handleAddToGoal(goal.id)}>
                                <ArrowDownToLine className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setSelectedGoal(null)}>×</Button>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setSelectedGoal(goal.id)}>
                              <Plus className="h-4 w-4 mr-1" />Add Funds
                            </Button>
                          )
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default SpendingInsights;
