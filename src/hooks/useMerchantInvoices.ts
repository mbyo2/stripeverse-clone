import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface MerchantInvoice {
  id: string;
  merchant_id: string;
  customer_email: string;
  customer_name: string | null;
  invoice_number: string;
  items: InvoiceItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  due_date: string | null;
  notes: string | null;
  status: string;
  payment_link_code: string;
  paid_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export const useMerchantInvoices = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['merchant-invoices', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_invoices')
        .select('*')
        .eq('merchant_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown) as MerchantInvoice[];
    },
    enabled: !!user?.id,
  });

  const createInvoice = useMutation({
    mutationFn: async (params: {
      customer_email: string;
      customer_name?: string;
      items: InvoiceItem[];
      tax_amount?: number;
      due_date?: string;
      notes?: string;
    }) => {
      const subtotal = params.items.reduce((sum, item) => sum + item.total, 0);
      const tax = params.tax_amount || 0;
      const { data, error } = await supabase
        .from('merchant_invoices')
        .insert({
          merchant_id: user!.id,
          customer_email: params.customer_email,
          customer_name: params.customer_name,
          items: params.items as any,
          subtotal,
          tax_amount: tax,
          total_amount: subtotal + tax,
          due_date: params.due_date,
          notes: params.notes,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-invoices'] });
      toast({ title: 'Invoice created' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === 'sent') updates.sent_at = new Date().toISOString();
      if (status === 'paid') updates.paid_at = new Date().toISOString();
      const { error } = await supabase.from('merchant_invoices').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-invoices'] });
    },
  });

  return { invoices, isLoading, createInvoice, updateStatus };
};
