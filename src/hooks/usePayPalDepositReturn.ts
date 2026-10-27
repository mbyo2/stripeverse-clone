import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { invalidateMoneyState } from '@/utils/moneyFreshness';

/**
 * PayPal deposit return flow.
 *
 * wallet-deposit sends the user to PayPal with a return URL of
 *   /wallet?paypal_return=deposit   (PayPal appends &token=<order id>)
 *   /wallet?paypal_return=cancelled (cancel URL)
 *
 * On return this hook hands the order id to the paypal-deposit-capture
 * edge function, which captures the order at PayPal, verifies amount
 * and currency against the recorded deposit, and credits the wallet.
 * The outcome shown here is whatever the server reports — a deposit is
 * only ever announced as confirmed when the wallet was actually
 * credited (by this call, or verifiably already).
 *
 * The cancel return (/wallet?paypal_return=cancelled&token=<order id>)
 * reports the cancellation to the same function (action: 'cancel'),
 * which verifies the claim against PayPal's own order state and only
 * then flips the still-pending deposit row to 'cancelled' — so Recent
 * Activity stops showing a deposit the payer abandoned as "awaiting
 * confirmation". If PayPal shows the order was in fact approved or
 * captured, the server answers with the confirmation outcome instead
 * and this hook announces that.
 */
export function usePayPalDepositReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const marker = searchParams.get('paypal_return');
    if (!marker) return;

    // Wait for the session before claiming the return, so the capture
    // call carries the user's JWT. The cancel return waits too when it
    // carries an order id — the cancellation is recorded server-side.
    if (marker === 'deposit' && !user) return;
    if (marker === 'cancelled' && searchParams.get('token') && !user) return;

    const key = `${marker}:${searchParams.get('token') ?? ''}`;
    if (handledRef.current === key) return;
    handledRef.current = key;

    const clearParams = () => navigate('/wallet', { replace: true });

    if (marker === 'cancelled') {
      const cancelledOrderId = searchParams.get('token');
      if (!cancelledOrderId || !user) {
        // No order reference to record the cancellation against:
        // today's behaviour — the payer did cancel at PayPal, and
        // nothing was charged.
        toast({
          title: 'Deposit cancelled',
          description: 'You cancelled the PayPal deposit. Nothing was charged.',
        });
        clearParams();
        return;
      }
      (async () => {
        const { data } = await supabase.functions.invoke('paypal-deposit-capture', {
          body: { order_id: cancelledOrderId, action: 'cancel' },
        });
        clearParams();
        if (data?.status === 'cancelled' || data?.status === 'completed') {
          // The row's state changed (cancelled) or money actually
          // arrived (completed): refresh every balance/activity
          // surface so the list tells the new truth.
          invalidateMoneyState(queryClient);
        }
        if (data?.status === 'completed') {
          toast({
            title: 'Deposit confirmed',
            description:
              'Good news — PayPal shows this payment was completed after all, and the money is in your wallet.',
          });
        } else {
          // 'cancelled', an unverifiable-for-now 'pending', or a call
          // failure: the payer cancelled at PayPal and nothing was
          // charged — the toast stays exactly that truth.
          toast({
            title: 'Deposit cancelled',
            description: 'You cancelled the PayPal deposit. Nothing was charged.',
          });
        }
      })();
      return;
    }

    if (marker !== 'deposit') {
      clearParams();
      return;
    }

    const orderId = searchParams.get('token');
    if (!orderId) {
      toast({
        title: 'Deposit could not be confirmed',
        description:
          'PayPal returned without an order reference, so nothing was credited. If money left your PayPal account, contact support with the transaction details.',
        variant: 'destructive',
      });
      clearParams();
      return;
    }

    (async () => {
      const { data, error } = await supabase.functions.invoke('paypal-deposit-capture', {
        body: { order_id: orderId },
      });
      clearParams();

      if (error || !data) {
        toast({
          title: 'Deposit confirmation is still pending',
          description:
            'We could not confirm your PayPal deposit just yet, so nothing has been credited. If you completed the payment at PayPal, it will be confirmed automatically — check your balance shortly.',
          variant: 'destructive',
        });
        return;
      }

      if (data.status === 'completed') {
        // A confirmed deposit credits the wallet: refresh every
        // balance/activity surface, not just the two caches.
        invalidateMoneyState(queryClient);
        toast({
          title: data.already_completed ? 'Deposit already confirmed' : 'Deposit confirmed',
          description:
            data.new_balance !== null && data.new_balance !== undefined
              ? `${data.currency} ${Number(data.amount).toFixed(2)} added to your wallet. New balance: ${data.currency} ${Number(data.new_balance).toFixed(2)}.`
              : `${data.currency} ${Number(data.amount).toFixed(2)} added to your wallet.`,
        });
      } else if (data.status === 'pending') {
        toast({
          title: 'Deposit still pending',
          description:
            data.message ||
            'PayPal has not completed this payment yet, so nothing has been credited.',
        });
      } else {
        toast({
          title: 'Deposit not completed',
          description:
            data.error ||
            'Your PayPal deposit could not be completed, and no money was credited.',
          variant: 'destructive',
        });
      }
    })();
  }, [searchParams, user, navigate, queryClient, toast]);
}
