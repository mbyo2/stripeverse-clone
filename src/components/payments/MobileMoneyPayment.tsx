import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Smartphone } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface MobileMoneyPaymentProps {
  amount: number;
  onSuccess: (response: { paymentId: string; method: string; status: string }) => void;
  onCancel: () => void;
}

/**
 * Mobile money checkout panel — HONEST UNAVAILABLE STATE.
 *
 * This component used to render a working-looking provider/phone
 * form and submit it to a backend that answers not_configured.
 * A payment option that can never succeed must not look like one
 * (audit 2026-10-26): there is deliberately NO form, NO phone
 * field and NO pay button here. Mobile money arrives through
 * DIRECT connections to MTN MoMo, Airtel Money and Zamtel once
 * telco merchant onboarding completes; until then the panel says
 * so plainly and points at what is live today (Bitcoin). The
 * props contract is unchanged so callers keep working — onSuccess
 * is simply never called, because no payment can start here.
 */
const MobileMoneyPayment = ({ amount, onCancel }: MobileMoneyPaymentProps) => {
  return (
    <div className="space-y-4">
      <Alert>
        <Smartphone className="h-4 w-4" />
        <AlertTitle>Mobile money isn't available yet</AlertTitle>
        <AlertDescription>
          We're connecting directly to MTN Mobile Money, Airtel Money and
          Zamtel — mobile money payments will open once those connections
          are live. For now, this {formatCurrency(amount)} payment can be
          made with Bitcoin instead.
        </AlertDescription>
      </Alert>
      <div className="pt-2 flex justify-between">
        <Button type="button" variant="outline" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
};

export default MobileMoneyPayment;
