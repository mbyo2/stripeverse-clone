// Deposit-method options for the Wallet "Add Money" dialog.
//
// Pure presentation logic: given which rails are actually available
// to this viewer, build the selector options (each labelled with its
// state in plain language) and choose the default. The default is
// the first AVAILABLE method, so the dialog never opens on a method
// that can only answer 'not_configured' while a live rail sits in
// the list. Nothing here changes what any method does — the deposit
// functions stay the source of truth for every method's behaviour,
// and each option's selectability matches what the dialog has
// always done:
//   - mobile money stays selectable while unconfigured, so its
//     explanation — and the function's truthful 'not_configured'
//     answer — remain reachable;
//   - PayPal is unselectable while its gate is off;
//   - the Stripe card rail is unselectable for viewers who may not
//     use it (it is admin-only while in sandbox).

import { PAYPAL_COMING_SOON_LABEL } from "../config/paypal";
import { NOT_AVAILABLE_YET_LABEL } from "../config/mobileMoney";
import { STRIPE_GATEWAY_MODE_LABEL } from "../config/stripeGateway";

export interface DepositMethodAvailability {
  paypalAvailable: boolean;
  mobileMoneyAvailable: boolean;
  /** Whether THIS viewer may use the Stripe card rail. */
  stripeCardAvailable: boolean;
}

export interface DepositMethodOption {
  /** Method value passed to the deposit flow, unchanged. */
  value: string;
  /** Full selector label, including the availability state. */
  label: string;
  available: boolean;
  /** Whether the selector renders the option unselectable. */
  disabled: boolean;
}

export function getDepositMethodOptions(
  availability: DepositMethodAvailability,
): DepositMethodOption[] {
  return [
    {
      value: "mobile_money",
      available: availability.mobileMoneyAvailable,
      disabled: false,
      label: availability.mobileMoneyAvailable
        ? "Mobile Money"
        : `Mobile Money — ${NOT_AVAILABLE_YET_LABEL}`,
    },
    {
      value: "paypal",
      available: availability.paypalAvailable,
      disabled: !availability.paypalAvailable,
      label: availability.paypalAvailable
        ? "PayPal"
        : `PayPal — ${PAYPAL_COMING_SOON_LABEL}`,
    },
    {
      value: "stripe_card",
      available: availability.stripeCardAvailable,
      disabled: !availability.stripeCardAvailable,
      label: availability.stripeCardAvailable
        ? `Card (Stripe)${STRIPE_GATEWAY_MODE_LABEL}`
        : "Card (Stripe) — Coming soon",
    },
  ];
}

/**
 * The method the dialog opens on: the first available option. If no
 * method is available, fall back to the first option so the dialog
 * still has a selection (its explanatory copy and the functions'
 * truthful responses remain reachable).
 */
export function selectDefaultDepositMethod(
  options: DepositMethodOption[],
): string {
  const firstAvailable = options.find((option) => option.available);
  if (firstAvailable) return firstAvailable.value;
  return options.length > 0 ? options[0].value : "mobile_money";
}
