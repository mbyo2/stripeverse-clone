// PayPal availability gate.
//
// CEO order (2026-10-22): PayPal is presented to users as "Coming
// soon" until the live PayPal credentials are configured. Production
// currently holds SANDBOX credentials, so an ungated PayPal button
// would walk a real user into the PayPal sandbox — that must not be
// reachable.
//
// Every user-facing PayPal entry point (wallet Add Money, the
// /checkout page, Pricing's PayPal checkout dialog, and the
// checkout-widget / developer copy) consults this constant. The
// machinery behind it — the wallet-deposit PayPal path,
// paypal-deposit-capture, the checkout capture path and the
// webhook routing — stays fully built behind the gate.
//
// GO-LIVE: once the live PayPal app credentials are set as the
// PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET function secrets (and
// PAYPAL_ENV=production), flip this to `true`. No other code change is
// required.
export const PAYPAL_AVAILABLE = false;

/** Label shown wherever PayPal is offered while the gate is off. */
export const PAYPAL_COMING_SOON_LABEL = "Coming soon";
