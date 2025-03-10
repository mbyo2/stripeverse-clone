
export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  payment_method: string;
  direction: 'incoming' | 'outgoing';
  recipient_name?: string;
  recipient_account?: string;
  recipient_bank?: string;
  status: 'pending' | 'completed' | 'failed';
  reference?: string;
  provider?: string;
  metadata?: any;
  created_at: string;
  updated_at: string;
}
