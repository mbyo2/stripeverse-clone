import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { resolveEdgeFunctionError } from '@/utils/edgeFunctionError';
import {
  MOONPAY_FIAT_CURRENCY,
  resolveMoonpaySessionOutcome,
} from '@/config/moonpay';

/**
 * MoonPay card on-ramp — enablement flag + start flow.
 *
 * Enablement: `platform_settings.moonpay_enabled` (default false),
 * read the same way the P2P shell reads `p2p_enabled` and the fee
 * hooks read their platform_settings columns — a single-row read of
 * the singleton settings row, failing CLOSED (disabled) on any
 * error. While the flag is off every user surface presents MoonPay
 * as "Coming soon" and this hook's start flow is not offered.
 * (The flag column ships with the MoonPay backend; the generated
 * types have not caught up with it yet, so the read goes through
 * the same untyped-client pattern other platform_settings readers
 * use for newer columns.)
 *
 * Start: `moonpay-session` (user JWT) records the purchase and
 * returns MoonPay's hosted checkout URL. Card data never touches
 * this app. Like the self-custody MoonPay buy, a blank tab is
 * pre-opened SYNCHRONOUSLY inside the click handler (mobile
 * browsers block window.open after an await) and navigated once
 * the session URL arrives; on any failure the tab is closed.
 * When MoonPay is not connected yet, the function answers with a
 * crafted not_configured / coming-soon body — its plain-language
 * message is toasted as-is.
 */
export function useMoonpay() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('platform_settings')
        .select('moonpay_enabled')
        .eq('id', true)
        .maybeSingle();
      if (cancelled) return;
      setEnabled(!error && data?.moonpay_enabled === true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startMoonpayBuy = async (input?: {
    fiatCurrency?: string;
    fiatAmount?: number;
  }): Promise<boolean> => {
    // Pre-open synchronously so the popup survives the await below.
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    setIsStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke('moonpay-session', {
        body: {
          fiatCurrency: input?.fiatCurrency ?? MOONPAY_FIAT_CURRENCY,
          fiatAmount: input?.fiatAmount,
        },
      });

      if (error || !data) {
        if (tab) tab.close();
        toast({
          title: 'Purchase could not be started',
          description: await resolveEdgeFunctionError(
            error,
            'Card purchases could not be started. No money has moved — please try again.',
          ),
          variant: 'destructive',
        });
        return false;
      }

      const outcome = resolveMoonpaySessionOutcome(data);
      if (outcome.kind !== 'ready') {
        if (tab) tab.close();
        toast({
          title:
            outcome.kind === 'not_configured'
              ? 'MoonPay is not connected yet'
              : outcome.kind === 'coming_soon'
                ? 'Card purchases are coming soon'
                : 'Purchase could not be started',
          description: outcome.message,
          variant: 'destructive',
        });
        return false;
      }

      // Hand the user to MoonPay's hosted checkout in the new tab;
      // the Bitcoin is delivered to their wallet once MoonPay
      // confirms the purchase (webhook), not here.
      if (tab) {
        tab.location.href = outcome.url;
      } else {
        window.open(outcome.url, '_blank', 'noopener,noreferrer');
      }
      return true;
    } catch (error) {
      if (tab) tab.close();
      toast({
        title: 'Purchase could not be started',
        description: await resolveEdgeFunctionError(
          error,
          'Card purchases could not be started. No money has moved — please try again.',
        ),
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsStarting(false);
    }
  };

  return { enabled, loading, startMoonpayBuy, isStartingMoonpayBuy: isStarting };
}
