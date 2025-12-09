-- Create transaction disputes table
CREATE TABLE public.transaction_disputes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL,
  user_id UUID NOT NULL,
  dispute_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL,
  evidence_urls TEXT[] DEFAULT '{}',
  resolution_notes TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  refund_amount NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add foreign key constraint
ALTER TABLE public.transaction_disputes 
  ADD CONSTRAINT fk_transaction FOREIGN KEY (transaction_id) REFERENCES public.transactions(uuid_id);

-- Enable RLS
ALTER TABLE public.transaction_disputes ENABLE ROW LEVEL SECURITY;

-- Simple RLS policies without subqueries
CREATE POLICY "Users can view their own disputes"
  ON public.transaction_disputes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own disputes"
  ON public.transaction_disputes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their pending disputes"
  ON public.transaction_disputes FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can manage all disputes"
  ON public.transaction_disputes FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create dispute messages table
CREATE TABLE public.dispute_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_id UUID NOT NULL REFERENCES public.transaction_disputes(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dispute_messages ENABLE ROW LEVEL SECURITY;

-- Simple RLS policies for messages
CREATE POLICY "Users can view non-internal messages for their disputes"
  ON public.dispute_messages FOR SELECT
  USING (
    is_internal = false AND
    EXISTS (SELECT 1 FROM public.transaction_disputes d WHERE d.id = dispute_id AND d.user_id = auth.uid())
  );

CREATE POLICY "Users can add messages to their disputes"
  ON public.dispute_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.transaction_disputes d WHERE d.id = dispute_id AND d.user_id = auth.uid())
  );

CREATE POLICY "Admins can manage all dispute messages"
  ON public.dispute_messages FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add indexes
CREATE INDEX idx_disputes_user_id ON public.transaction_disputes(user_id);
CREATE INDEX idx_disputes_status ON public.transaction_disputes(status);
CREATE INDEX idx_disputes_transaction_id ON public.transaction_disputes(transaction_id);
CREATE INDEX idx_dispute_messages_dispute_id ON public.dispute_messages(dispute_id);

-- Add updated_at trigger
CREATE TRIGGER update_transaction_disputes_updated_at
  BEFORE UPDATE ON public.transaction_disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();