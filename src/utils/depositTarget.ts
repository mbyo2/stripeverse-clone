// Pure targeting rules for wallet deposits (Workstream B contract).
//
// wallet-deposit lets the caller name the target explicitly: a
// wallet_id (validated server-side, and rejected when a supplied
// currency does not match that wallet's currency) or, with no
// wallet_id, a currency — in which case the function resolves the
// caller's Main wallet in that currency, creating it on demand.
//
// PayPal does not support ZMW as a checkout currency, so a PayPal
// deposit aimed at the viewed (ZMW) wallet can only fail at order
// creation. Rather than let the user walk into that failure, a PayPal
// deposit is always USD-denominated and targets a USD wallet: the
// user's USD wallet in the viewed account when one is known, and
// otherwise no wallet_id at all, so the function's Main-wallet
// fallback resolves (or creates) the Main USD wallet. Every other
// method targets the viewed wallet exactly as the caller passed it.

export interface DepositTarget {
  /** Wallet id to pass as wallet_id; undefined = let the function resolve. */
  walletId?: string;
  /** Currency to pass; must match the named wallet's currency. */
  currency?: string;
}

export function resolveDepositTarget(input: {
  paymentMethod: string;
  /** The wallet the user is viewing (id + currency), as the caller passes them. */
  walletId?: string;
  currency?: string;
  /** The user's USD wallet id in the same account scope, when one exists. */
  usdWalletId?: string | null;
}): DepositTarget {
  if (input.paymentMethod !== "paypal") {
    return { walletId: input.walletId, currency: input.currency };
  }
  return input.usdWalletId
    ? { walletId: input.usdWalletId, currency: "USD" }
    : { walletId: undefined, currency: "USD" };
}
