import { toUserFacingError } from "@/utils/userFacingError";
import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Clock, SearchX, Info } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { usePayPalCheckoutReturn } from "@/hooks/usePayPalCheckoutReturn";
import { PAYPAL_AVAILABLE, PAYPAL_COMING_SOON_LABEL } from "@/config/paypal";
import MobileMoneyPayment from "@/components/payments/MobileMoneyPayment";
import UssdPayment from "@/components/payments/UssdPayment";
import BitcoinPayment from "@/components/payments/BitcoinPayment";
import CardPayment from "@/components/payments/CardPayment";

interface CheckoutResponse {
  paymentId: string;
  method: string;
  status: string;
}

/**
 * What a real in-app checkout carries (router state from the flow
 * that started it). There is no product catalogue behind this route,
 * so nothing here may be invented: without a named item and amount
 * there is no checkout to show.
 */
interface CheckoutState {
  productName?: string;
  amount?: number;
  currency?: string;
  description?: string;
  /** The merchant a PayPal payment settles to (process-payment terms). */
  merchantUserId?: string;
  merchantName?: string;
}

const METHODS = ["mobile", "card", "ussd", "bitcoin", "paypal"] as const;
type Method = (typeof METHODS)[number];

const Checkout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const checkoutReturn = usePayPalCheckoutReturn();

  const state = (location.state ?? {}) as CheckoutState;
  const productName = typeof state.productName === "string" ? state.productName : null;
  const amount = typeof state.amount === "number" && state.amount > 0 ? state.amount : null;
  const currency = state.currency || "ZMW";
  const merchantUserId = state.merchantUserId || null;

  // /checkout/<segment>: the segment names a product this route cannot
  // load — there is no product catalogue — so it is an honest
  // not-found, never a fabricated product page.
  const pathSegment = location.pathname.replace(/^\/checkout\/?/, "").split("/")[0];
  const productId = pathSegment ? decodeURIComponent(pathSegment) : null;

  const methodParam = searchParams.get("method");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(
    // A ?method=paypal preselect is honoured only while PayPal is
    // available; while the gate is off PayPal cannot become selected.
    methodParam && (METHODS as readonly string[]).includes(methodParam) &&
      !(methodParam === "paypal" && !PAYPAL_AVAILABLE)
      ? methodParam
      : "",
  );
  const [paymentComplete, setPaymentComplete] = useState<CheckoutResponse | null>(null);
  const [startingPaypal, setStartingPaypal] = useState(false);
  const [paypalError, setPaypalError] = useState<string | null>(null);

  const handlePaymentComplete = (response: CheckoutResponse) => {
    setPaymentComplete(response);
  };

  const handleGoBack = () => {
    navigate(-1);
  };

  const startPayPal = async () => {
    // PayPal gate: unreachable while PAYPAL_AVAILABLE is off (the
    // method button is disabled then) — this guard keeps it that way
    // for any other caller of this handler.
    if (!PAYPAL_AVAILABLE) return;
    if (!merchantUserId || amount === null || !productName) return;
    setStartingPaypal(true);
    setPaypalError(null);
    try {
      const { data, error } = await supabase.functions.invoke("process-payment", {
        body: {
          amount,
          currency,
          paymentMethod: "paypal",
          provider: "paypal",
          description: productName,
          metadata: {
            merchant_user_id: merchantUserId,
            return_url: `${window.location.origin}/checkout?paypal_return=checkout`,
            cancel_url: `${window.location.origin}/checkout?paypal_return=cancelled`,
          },
        },
      });
      if (error || !data) {
        setPaypalError(
          error
            ? await resolveEdgeFunctionError(error, "PayPal could not start this payment. No money was charged.")
            : "PayPal could not start this payment. No money was charged.",
        );
        return;
      }
      if (data.status === "pending" && data.approval_url) {
        // Hand the buyer to PayPal; settlement happens on the return
        // (usePayPalCheckoutReturn → paypal-checkout-capture) or via
        // the webhook backstop. Nothing is complete at this point.
        window.location.href = data.approval_url as string;
        return;
      }
      setPaypalError(
        (data.error as string) || "PayPal could not start this payment. No money was charged.",
      );
    } catch (e) {
      setPaypalError(toUserFacingError(e, "PayPal could not start this payment."));
    } finally {
      setStartingPaypal(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4">{children}</main>
      <Footer />
    </div>
  );

  // ── PayPal return: the outcome is whatever the server confirms ────
  if (checkoutReturn.phase !== "idle") {
    return shell(
      <div className="max-w-md mx-auto text-center">
        {checkoutReturn.phase === "confirming" && (
          <>
            <Clock className="mx-auto mb-4 h-16 w-16 text-muted-foreground animate-pulse" />
            <h2 className="text-3xl font-bold mb-4">Confirming your payment…</h2>
            <p className="text-muted-foreground mb-6">
              Checking with PayPal and settling the merchant. This takes a few seconds.
            </p>
          </>
        )}
        {checkoutReturn.phase === "completed" && (
          <>
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
            <h2 className="text-3xl font-bold mb-4">Payment confirmed</h2>
            <p className="text-muted-foreground mb-6">
              Your payment of {checkoutReturn.currency} {checkoutReturn.amount.toFixed(2)} was
              captured by PayPal and settled to the merchant.
              {checkoutReturn.alreadyCompleted ? " It had already been confirmed earlier." : ""}
            </p>
            <Button onClick={handleGoBack}>Go Back</Button>
          </>
        )}
        {checkoutReturn.phase === "pending" && (
          <>
            <Clock className="mx-auto mb-4 h-16 w-16 text-amber-500" />
            <h2 className="text-3xl font-bold mb-4">Payment still pending</h2>
            <p className="text-muted-foreground mb-6">{checkoutReturn.message}</p>
            <Button onClick={handleGoBack}>Go Back</Button>
          </>
        )}
        {checkoutReturn.phase === "cancelled" && (
          <>
            <AlertCircle className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
            <h2 className="text-3xl font-bold mb-4">Payment cancelled</h2>
            <p className="text-muted-foreground mb-6">
              You cancelled the PayPal payment. Nothing was charged and the merchant has not
              been paid.
            </p>
            <Button onClick={handleGoBack}>Go Back</Button>
          </>
        )}
        {checkoutReturn.phase === "failed" && (
          <>
            <AlertCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
            <h2 className="text-3xl font-bold mb-4">Payment not completed</h2>
            <p className="text-muted-foreground mb-6">{checkoutReturn.message}</p>
            <Button onClick={handleGoBack}>Go Back</Button>
          </>
        )}
      </div>,
    );
  }

  // ── /checkout/<productId>: no catalogue exists → honest not-found ─
  if (productId) {
    return shell(
      <div className="max-w-md mx-auto text-center">
        <SearchX className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
        <h2 className="text-3xl font-bold mb-4">Product not found</h2>
        <p className="text-muted-foreground mb-6">
          We couldn't find a product with this reference. Products aren't listed in a public
          catalogue here — if a seller sent you this link, ask them for a payment link instead,
          which carries the exact item and amount.
        </p>
        <Button onClick={handleGoBack}>Go Back</Button>
      </div>,
    );
  }

  // ── No real checkout was started → say so, invent nothing ────────
  if (!productName || amount === null) {
    return shell(
      <div className="max-w-md mx-auto">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This checkout doesn't name an item or an amount, so there's nothing to pay here.
            Checkouts start from a seller's page or a payment link, which carry the exact item
            and price — open one of those to pay. Nothing on this page can charge you.
          </AlertDescription>
        </Alert>
        <div className="text-center mt-6">
          <Button onClick={handleGoBack}>Go Back</Button>
        </div>
      </div>,
    );
  }

  // ── A real checkout: the named item, at its real amount ──────────
  return shell(
    paymentComplete ? (
      <div className="max-w-md mx-auto text-center">
        <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
        <h2 className="text-3xl font-bold mb-4">
          {paymentComplete.status === "completed" ? "Payment Successful!" : "Payment submitted"}
        </h2>
        <p className="text-muted-foreground mb-6">
          {paymentComplete.status === "completed"
            ? "Thank you for your purchase. Your payment has been processed successfully."
            : `Your payment status is "${paymentComplete.status}". It is not complete until it is confirmed.`}
        </p>
        <Button onClick={handleGoBack}>Go Back</Button>
      </div>
    ) : (
      <div className="max-w-md mx-auto">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <span>{productName}</span>
              <Badge variant="secondary">{formatCurrency(amount)}</Badge>
            </div>
            {state.merchantName && (
              <p className="text-sm text-muted-foreground">Sold by {state.merchantName}</p>
            )}
            {state.description && (
              <p className="text-sm text-muted-foreground mt-1">{state.description}</p>
            )}
          </CardContent>
        </Card>

        <div className="max-w-md mx-auto mb-8">
          <h2 className="text-2xl font-bold mb-4">Select Payment Method</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Button
              variant={selectedPaymentMethod === "mobile" ? "default" : "outline"}
              onClick={() => setSelectedPaymentMethod("mobile")}
            >
              Mobile Money
            </Button>
            <Button
              variant={selectedPaymentMethod === "card" ? "default" : "outline"}
              onClick={() => setSelectedPaymentMethod("card")}
            >
              Card Payment
            </Button>
            <Button
              variant={selectedPaymentMethod === "ussd" ? "default" : "outline"}
              onClick={() => setSelectedPaymentMethod("ussd")}
            >
              USSD
            </Button>
            <Button
              variant={selectedPaymentMethod === "bitcoin" ? "default" : "outline"}
              onClick={() => setSelectedPaymentMethod("bitcoin")}
            >
              Bitcoin
            </Button>
            <Button
              variant={selectedPaymentMethod === "paypal" ? "default" : "outline"}
              onClick={() => setSelectedPaymentMethod("paypal")}
              disabled={!PAYPAL_AVAILABLE}
            >
              PayPal{!PAYPAL_AVAILABLE && ` — ${PAYPAL_COMING_SOON_LABEL}`}
            </Button>
          </div>

          {selectedPaymentMethod === "mobile" && (
            <div className="bg-card rounded-lg shadow p-4 mb-4 border border-border">
              <MobileMoneyPayment
                amount={amount}
                onSuccess={handlePaymentComplete}
                onCancel={() => setSelectedPaymentMethod("")}
              />
            </div>
          )}

          {selectedPaymentMethod === "card" && (
            <div className="bg-card rounded-lg shadow p-4 mb-4 border border-border">
              <CardPayment
                amount={amount}
                onSuccess={handlePaymentComplete}
                onCancel={() => setSelectedPaymentMethod("")}
              />
            </div>
          )}

          {selectedPaymentMethod === "ussd" && (
            <div className="bg-card rounded-lg shadow p-4 mb-4 border border-border">
              <UssdPayment
                amount={amount}
                onSuccess={handlePaymentComplete}
                onCancel={() => setSelectedPaymentMethod("")}
              />
            </div>
          )}

          {selectedPaymentMethod === "bitcoin" && (
            <div className="bg-card rounded-lg shadow p-4 mb-4 border border-border">
              <BitcoinPayment
                amount={amount}
                onSuccess={handlePaymentComplete}
                onCancel={() => setSelectedPaymentMethod("")}
              />
            </div>
          )}

          {selectedPaymentMethod === "paypal" && (
            <div className="bg-card rounded-lg shadow p-4 mb-4 border border-border space-y-4">
              {merchantUserId ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    You'll be redirected to PayPal to approve {formatCurrency(amount)}. The
                    payment completes only after PayPal confirms it — the merchant is settled
                    then, not before.
                  </p>
                  {paypalError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{paypalError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setSelectedPaymentMethod("")}>
                      Cancel
                    </Button>
                    <Button onClick={startPayPal} disabled={startingPaypal}>
                      {startingPaypal ? "Starting…" : `Pay with PayPal`}
                    </Button>
                  </div>
                </>
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    This checkout doesn't name a merchant, so a PayPal payment from here would
                    have nobody to settle to. Ask the seller for a payment link, or check out
                    from their page where the merchant is named.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    ),
  );
};

export default Checkout;
