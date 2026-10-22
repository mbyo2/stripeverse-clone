import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveEdgeFunctionError } from '@/utils/edgeFunctionError';

/**
 * PayPal checkout return flow — the twin of usePayPalDepositReturn,
 * for `process-payment` checkout orders.
 *
 * process-payment sends the buyer to PayPal with a return URL of
 *   /checkout?paypal_return=checkout   (PayPal appends &token=<order id>)
 *   /checkout?paypal_return=cancelled  (cancel URL)
 *
 * On return this hook hands the order id to the paypal-checkout-capture
 * edge function, which captures the order at PayPal, verifies amount
 * and currency against the recorded checkout payment, and settles the
 * merchant exactly once. The state exposed here is whatever the server
 * reports — a payment is only ever shown as confirmed when the
 * merchant was actually paid (by this call, or verifiably already).
 * The outcome stays in component state after the URL params are
 * cleared, so the confirmation panel survives the cleanup.
 */
export type PayPalCheckoutReturnState =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'completed'; amount: number; currency: string; alreadyCompleted: boolean }
  | { phase: 'pending'; message: string }
  | { phase: 'cancelled' }
  | { phase: 'failed'; message: string };

export function usePayPalCheckoutReturn(): PayPalCheckoutReturnState {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [state, setState] = useState<PayPalCheckoutReturnState>({ phase: 'idle' });
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const marker = searchParams.get('paypal_return');
    if (!marker) return;

    // Wait for the session before claiming the return, so the capture
    // call carries the buyer's JWT (the capture is pinned to the
    // recorded payer).
    if (marker === 'checkout' && !user) {
      setState({ phase: 'confirming' });
      return;
    }

    const key = `${marker}:${searchParams.get('token') ?? ''}`;
    if (handledRef.current === key) return;
    handledRef.current = key;

    const clearParams = () =>
      navigate(location.pathname, { replace: true, state: location.state });

    if (marker === 'cancelled') {
      setState({ phase: 'cancelled' });
      clearParams();
      return;
    }

    if (marker !== 'checkout') {
      clearParams();
      return;
    }

    const orderId = searchParams.get('token');
    if (!orderId) {
      setState({
        phase: 'failed',
        message:
          'PayPal returned without an order reference, so the payment could not be confirmed and the merchant has not been paid. If money left your PayPal account, contact support with the transaction details.',
      });
      clearParams();
      return;
    }

    setState({ phase: 'confirming' });
    (async () => {
      const { data, error } = await supabase.functions.invoke('paypal-checkout-capture', {
        body: { order_id: orderId },
      });
      clearParams();

      if (error || !data) {
        setState({
          phase: 'failed',
          message: error
            ? await resolveEdgeFunctionError(
                error,
                'We could not confirm your PayPal payment just yet, so the merchant has not been paid. If you completed the payment at PayPal, it will be confirmed automatically — check again shortly.',
              )
            : 'We could not confirm your PayPal payment just yet, so the merchant has not been paid. If you completed the payment at PayPal, it will be confirmed automatically — check again shortly.',
        });
        return;
      }

      if (data.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        setState({
          phase: 'completed',
          amount: Number(data.amount),
          currency: String(data.currency),
          alreadyCompleted: Boolean(data.already_completed),
        });
      } else if (data.status === 'pending') {
        setState({
          phase: 'pending',
          message:
            data.message ||
            'PayPal has not completed this payment yet, so the merchant has not been paid.',
        });
      } else {
        setState({
          phase: 'failed',
          message:
            data.error ||
            'Your PayPal payment could not be completed, and the merchant has not been paid.',
        });
      }
    })();
  }, [searchParams, user, navigate, queryClient, location.pathname, location.state]);

  return state;
}
