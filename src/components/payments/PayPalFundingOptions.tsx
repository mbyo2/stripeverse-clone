import { CreditCard, Wallet } from "lucide-react";
import {
  PAYPAL_FUNDING_OPTIONS,
  type PayPalFunding,
} from "@/utils/paypalFunding";

interface PayPalFundingOptionsProps {
  value: PayPalFunding;
  onChange: (value: PayPalFunding) => void;
}

/**
 * The PayPal sub-options shown when a payer picks the top-level
 * "PayPal" method (CEO directive 2026-10-27): pay by card THROUGH
 * PayPal, or pay from a PayPal account. Both complete on PayPal's
 * own page through the same order — the choice only steers which
 * PayPal page opens first (see src/utils/paypalFunding.ts). A
 * future direct "Card" method is a separate top-level sibling and
 * never appears inside this group.
 */
export const PayPalFundingOptions = ({
  value,
  onChange,
}: PayPalFundingOptionsProps) => (
  <div className="space-y-2">
    <p className="text-sm font-medium">How do you want to pay with PayPal?</p>
    <div className="grid gap-2" role="radiogroup" aria-label="Pay with PayPal as">
      {PAYPAL_FUNDING_OPTIONS.map((option) => {
        const selected = option.value === value;
        const Icon = option.value === "paypal_card" ? CreditCard : Wallet;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/50"
            }`}
          >
            <span className="flex items-center gap-2 font-medium text-sm">
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              {option.title}
            </span>
            <span className="block text-xs text-muted-foreground mt-1">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
    <p className="text-xs text-muted-foreground">
      Both ways are handled by PayPal — if you change your mind, you can switch
      on PayPal's page.
    </p>
  </div>
);

export default PayPalFundingOptions;
