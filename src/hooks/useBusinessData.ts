import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export const useBusinessData = () => {
  const { user } = useAuth();

  const { data: merchantAccount, isLoading: merchantLoading } = useQuery({
    queryKey: ['merchant-account', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('merchant_accounts_safe')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const { data: businessTransactions, isLoading: txLoading } = useQuery({
    queryKey: ['business-transactions', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: webhooks, isLoading: webhooksLoading } = useQuery({
    queryKey: ['business-webhooks', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('business_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['business-usage', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');
      const currentMonth = new Date().toISOString().slice(0, 7);
      const { data, error } = await supabase
        .from('subscription_usage')
        .select('*')
        .eq('user_id', user.id)
        .eq('month_year', currentMonth)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Compute metrics from real transactions
  const metrics = (() => {
    if (!businessTransactions) return { revenue: 0, txCount: 0, successRate: 0 };
    const completed = businessTransactions.filter(t => t.status === 'completed');
    const incoming = completed.filter(t => t.direction === 'incoming');
    const revenue = incoming.reduce((sum, t) => sum + Number(t.amount), 0);
    const successRate = businessTransactions.length > 0
      ? (completed.length / businessTransactions.length) * 100
      : 0;
    return {
      revenue,
      txCount: businessTransactions.length,
      successRate: Math.round(successRate * 10) / 10,
    };
  })();

  const monthlyChart = (() => {
    if (!businessTransactions) return [];
    const byMonth: Record<string, { amount: number; count: number }> = {};
    businessTransactions.forEach(t => {
      if (t.status !== 'completed' || t.direction !== 'incoming') return;
      const month = new Date(t.created_at || '').toLocaleString('default', { month: 'short' });
      if (!byMonth[month]) byMonth[month] = { amount: 0, count: 0 };
      byMonth[month].amount += Number(t.amount);
      byMonth[month].count += 1;
    });
    return Object.entries(byMonth).map(([month, data]) => ({
      month,
      amount: data.amount,
      transactions: data.count,
    }));
  })();

  const paymentMethodBreakdown = (() => {
    if (!businessTransactions) return [];
    const byMethod: Record<string, number> = {};
    businessTransactions.forEach(t => {
      const method = t.payment_method || 'Other';
      byMethod[method] = (byMethod[method] || 0) + 1;
    });
    const total = Object.values(byMethod).reduce((a, b) => a + b, 0) || 1;
    const colors = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--muted))', 'hsl(var(--secondary))'];
    return Object.entries(byMethod).map(([name, count], i) => ({
      name,
      value: Math.round((count / total) * 100),
      color: colors[i % colors.length],
    }));
  })();

  return {
    merchantAccount,
    businessTransactions,
    webhooks,
    usageData,
    metrics,
    monthlyChart,
    paymentMethodBreakdown,
    isLoading: merchantLoading || txLoading || webhooksLoading || usageLoading,
  };
};
