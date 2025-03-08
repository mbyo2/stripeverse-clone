
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PaymentForm from "@/components/PaymentForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

const Checkout = () => {
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get amount from location state or use default
  const amount = location.state?.amount || 100;
  const productName = location.state?.productName || "BMaGlass Pay Service";
  
  const handlePaymentSuccess = (response: { 
    paymentId: string; 
    method: string; 
    status: string;
  }) => {
    setPaymentDetails(response);
    setPaymentComplete(true);
    
    // Redirect after payment (with a delay)
    setTimeout(() => {
      navigate("/dashboard", { 
        state: { 
          paymentSuccess: true,
          paymentDetails: response
        } 
      });
    }, 3000);
  };
  
  const handleCancel = () => {
    navigate(-1);
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h1 className="text-3xl font-bold mb-6">Complete Your Payment</h1>
            
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b">
                    <span className="font-medium">{productName}</span>
                    <span>{formatCurrency(amount)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center pb-4 border-b">
                    <span className="text-muted-foreground">Service Fee</span>
                    <span>{formatCurrency(5)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center font-bold">
                    <span>Total</span>
                    <span>{formatCurrency(amount + 5)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {paymentComplete && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-6">
                  <div className="flex items-start">
                    <div className="shrink-0 mr-3">
                      <CheckCircle2 className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium">Payment Successful</h3>
                      <p className="text-sm text-muted-foreground">
                        Payment ID: {paymentDetails?.paymentId}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Redirecting you to dashboard...
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          
          <div>
            <PaymentForm 
              amount={amount + 5} 
              onSuccess={handlePaymentSuccess} 
              onCancel={handleCancel}
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Checkout;
