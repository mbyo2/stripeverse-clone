import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { formatCurrency } from "@/lib/utils";
import MobileMoneyPayment from "@/components/payments/MobileMoneyPayment";
import UssdPayment from "@/components/payments/UssdPayment";
import BitcoinPayment from "@/components/payments/BitcoinPayment";
import CardPayment from "@/components/payments/CardPayment";

interface CheckoutResponse {
  paymentId: string;
  method: string;
  status: string;
}

const Checkout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [paymentComplete, setPaymentComplete] = useState(false);
  const productName = location.state?.productName || "Generic Product";
  const amount = location.state?.amount || 100;
  const showPaymentMethods = !paymentComplete;

  const handlePaymentComplete = (response: CheckoutResponse) => {
    setPaymentComplete(true);
  };

  const handleGoBack = () => {
    navigate(-1);
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4">
        {paymentComplete ? (
          <div className="max-w-md mx-auto text-center">
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
            <h2 className="text-3xl font-bold mb-4">Payment Successful!</h2>
            <p className="text-muted-foreground mb-6">
              Thank you for your purchase. Your payment has been processed successfully.
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
              </CardContent>
            </Card>
            
            {showPaymentMethods && (
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
                </div>
                
                {selectedPaymentMethod === "mobile" && (
                  <div className="bg-white rounded-lg shadow p-4 mb-4">
                    <MobileMoneyPayment
                      amount={amount}
                      onSuccess={handlePaymentComplete}
                      onCancel={() => setSelectedPaymentMethod("")}
                    />
                  </div>
                )}
                
                {selectedPaymentMethod === "card" && (
                  <div className="bg-white rounded-lg shadow p-4 mb-4">
                    <CardPayment 
                      amount={amount} 
                      onSuccess={handlePaymentComplete}
                      onCancel={() => setSelectedPaymentMethod("")}
                    />
                  </div>
                )}
                
                {selectedPaymentMethod === "ussd" && (
                  <div className="bg-white rounded-lg shadow p-4 mb-4">
                    <UssdPayment
                      amount={amount}
                      onSuccess={handlePaymentComplete}
                      onCancel={() => setSelectedPaymentMethod("")}
                    />
                  </div>
                )}
                
                {selectedPaymentMethod === "bitcoin" && (
                  <div className="bg-white rounded-lg shadow p-4 mb-4">
                    <BitcoinPayment
                      amount={amount}
                      onSuccess={handlePaymentComplete}
                      onCancel={() => setSelectedPaymentMethod("")}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Checkout;
