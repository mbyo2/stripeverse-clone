import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { invalidateMoneyState } from '@/utils/moneyFreshness';
import { resolveEdgeFunctionError } from '@/utils/edgeFunctionError';

/**
 * Stripe gateway wallet top-up (brief §3) — start + return flows.
 *
 * Start: the Wallet page's "Card (Stripe)" option (admin/super_admin
 * only; the edge function enforces the same gate server-side) calls
 * stripe-gateway-checkout, which records a PENDING ledger row and
 * returns a Stripe-hosted Checkout URL. The browser is redirected
 * there; card data never touches this app.
 *
 * Return: Stripe sends the user back to
 *   /wallet?stripe_return=success&session_id=<session id>
 *   /wallet?stripe_return=cancelled
 * Settlement is WEBHOOK-only (stripe-gateway-webhook re-queries the
 * session and credits exactly once), so unlike the PayPal hook there
 * is NO capture call here — the return hook only reports honestly:
 * a success return means Stripe accepted the payment, and the credit
 * lands when the webhook confirms it. It refreshes money state a few
 * times over the following seconds so the credit appears as soon as
 * it lands, without ever claiming it before it does.
 */
export function useStripeGatewayDeposit() {
  const { toast } = useToast();
  const [isStarting, setIsStarting] = useState(false);

  const startStripeTopUp = async (input: {
    amount: number;
    walletId?: string;
    currency?: string;
    accountId?: string | null;
  }): Promise<boolean> => {
    setIsStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-gateway-checkout', {
        body: {
          amount: input.amount,
          wallet_id: input.walletId,
          currency: input.currency,
          account_id: input.accountId ?? undefined,
        },
      });

      if (error || !data) {
        toast({
          title: 'Top-up could not be started',
          description: await resolveEdgeFunctionError(
            error,
            'Card top-ups could not be started. No money has moved — please try again.',
          ),
          variant: 'destructive',
        });
        return false;
      }

      if (data.status === 'not_configured') {
        toast({
          title: 'Card top-ups are not switched on yet',
          description:
            data.error ||
            "Stripe is still being connected for card top-ups. No money has moved.",
          variant: 'destructive',
        });
        return false;
      }

      if (!data.success || !data.url) {
        toast({
          title: 'Top-up could not be started',
          description: data.error || 'Stripe could not start this top-up. No money was charged.',
          variant: 'destructive',
        });
        return false;
      }

      // Hand the user to Stripe's hosted checkout; the wallet is
      // credited by the webhook after confirmation, not here. (There
      // is no currency fallback to announce: since audit fix D1 the
      // server refuses a currency Stripe won't take instead of
      // re-charging the same amount in USD.)
      window.location.href = data.url as string;
      return true;
    } finally {
      setIsStarting(false);
    }
  };

  return { startStripeTopUp, isStartingStripeTopUp: isStarting };
}

export function useStripeGatewayReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const marker = searchParams.get('stripe_return');
    if (!marker) return;

    const key = `${marker}:${searchParams.get('session_id') ?? ''}`;
    if (handledRef.current === key) return;
    handledRef.current = key;

    const clearParams = () => navigate('/wallet', { replace: true });

    if (marker === 'cancelled') {
      toast({
        title: 'Top-up cancelled',
        description: 'You cancelled the card top-up. Nothing was charged.',
      });
      clearParams();
      return;
    }

    if (marker !== 'success') {
      clearParams();
      return;
    }

    // Stripe accepted the payment. The credit itself lands via the
    // webhook (re-query + exactly-once RPC), usually within seconds:
    // say exactly that, and refresh money state a few times so the
    // new balance shows as soon as it exists — never before.
    toast({
      title: 'Payment received by Stripe',
      description:
        'Stripe is confirming your top-up. Your wallet is credited as soon as the confirmation lands — usually a few seconds.',
    });
    clearParams();
    invalidateMoneyState(queryClient);
    const timers = [2500, 6000, 12000].map((ms) =>
      window.setTimeout(() => invalidateMoneyState(queryClient), ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [searchParams, navigate, queryClient, toast]);
}
