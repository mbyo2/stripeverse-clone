
export interface Transaction {
  id: number;
  user_id?: string;
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
  created_at: string;
  updated_at?: string;
  metadata?: any;
}

export interface TransactionFilter {
  startDate?: Date;
  endDate?: Date;
  type?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  paymentMethod?: string;
}
