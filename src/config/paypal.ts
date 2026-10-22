// PayPal availability gate.
//
// History: until 2026-10-22 PayPal was presented to users as
// "Coming soon" on CEO order, because production then held SANDBOX
// credentials — an ungated PayPal button would have walked a real
// user into the PayPal sandbox.
//
// GO-LIVE (2026-10-22): the CEO has set the LIVE PayPal app
// credentials as the PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET function
// secrets with PAYPAL_ENV=production, plus PAYPAL_WEBHOOK_ID for the
// webhook listener (whose signature verification now runs through
// PayPal's verify-webhook-signature API). This gate is therefore ON:
// every user-facing PayPal entry point (wallet Add Money, the
// /checkout page, Pricing's PayPal checkout dialog, and the
// checkout-widget / developer copy) offers PayPal for real.
//
// If PayPal ever has to be pulled again, flip this back to `false` —
// the entry points above all consult this one constant, the deposit
// mutation in useWallet refuses PayPal while it is off, and the
// machinery behind the gate (wallet-deposit PayPal path,
// paypal-deposit-capture, paypal-checkout-capture and the webhook
// routing) stays built and harmless while it is off.
export const PAYPAL_AVAILABLE = true;

/** Label shown wherever PayPal is offered while the gate is off. */
export const PAYPAL_COMING_SOON_LABEL = "Coming soon";
