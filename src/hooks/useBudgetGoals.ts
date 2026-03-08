import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface BudgetGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  category: string | null;
  icon: string;
  color: string;
  deadline: string | null;
  status: string;
  created_at: string;
}

export interface SpendingBudget {
  id: string;
  user_id: string;
  category: string;
  monthly_limit: number;
  month_year: string;
  spent_amount: number;
  alert_threshold: number;
}

export const useBudgetGoals = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['budget-goals', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_goals')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as BudgetGoal[];
    },
    enabled: !!user?.id,
  });

  const { data: budgets = [], isLoading: budgetsLoading } = useQuery({
    queryKey: ['spending-budgets', user?.id],
    queryFn: async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const { data, error } = await supabase
        .from('spending_budgets')
        .select('*')
        .eq('user_id', user!.id)
        .eq('month_year', currentMonth);
      if (error) throw error;
      return data as SpendingBudget[];
    },
    enabled: !!user?.id,
  });

  const createGoal = useMutation({
    mutationFn: async (params: { name: string; target_amount: number; category?: string; deadline?: string; color?: string }) => {
      const { data, error } = await supabase
        .from('budget_goals')
        .insert({ user_id: user!.id, ...params })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-goals'] });
      toast({ title: 'Savings goal created!' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const addToGoal = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const goal = goals.find((g) => g.id === id);
      if (!goal) throw new Error('Goal not found');
      const { error } = await supabase
        .from('budget_goals')
        .update({
          current_amount: goal.current_amount + amount,
          status: goal.current_amount + amount >= goal.target_amount ? 'completed' : 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-goals'] });
      toast({ title: 'Funds added to goal!' });
    },
  });

  const setBudget = useMutation({
    mutationFn: async (params: { category: string; monthly_limit: number }) => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const { data, error } = await supabase
        .from('spending_budgets')
        .upsert({
          user_id: user!.id,
          category: params.category,
          monthly_limit: params.monthly_limit,
          month_year: currentMonth,
        }, { onConflict: 'user_id,category,month_year' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spending-budgets'] });
      toast({ title: 'Budget set!' });
    },
  });

  return { goals, budgets, goalsLoading, budgetsLoading, createGoal, addToGoal, setBudget };
};
