
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PaymentForm from "@/components/PaymentForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import PaymentMethodList from "@/components/wallet/PaymentMethodList";
import { paymentMethods } from "@/data/mockData";

interface PaymentDetails {
  paymentId: string;
  method: string;
  status: string;
}

const Checkout = () => {
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'failed' | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<any>(null);
  const [useExistingMethod, setUseExistingMethod] = useState(false);
  
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get amount from location state or use default
  const amount = location.state?.amount || 100;
  const productName = location.state?.productName || "BMaGlass Pay Service";
  
  // Simulate checking payment status
  useEffect(() => {
    if (paymentDetails?.paymentId && paymentStatus === 'pending') {
      // Simulate a status check with the server
      const timer = setTimeout(() => {
        // For demonstration purposes, we'll just set to success
        setPaymentStatus('success');
        
        toast({
          title: "Payment confirmed",
          description: `Your payment of ${formatCurrency(amount)} has been confirmed.`,
        });
        
        // Redirect after confirming payment
        setTimeout(() => {
          navigate("/dashboard", { 
            state: { 
              paymentSuccess: true,
              paymentDetails
            } 
          });
        }, 3000);
      }, 2000); // Faster processing time
      
      return () => clearTimeout(timer);
    }
  }, [paymentDetails, paymentStatus, amount, navigate, toast]);
  
  const handlePaymentSuccess = (response: PaymentDetails) => {
    setPaymentDetails(response);
    setPaymentComplete(true);
    setPaymentStatus(response.status === 'pending' ? 'pending' : 'success');
    
    toast({
      title: response.status === 'pending' ? "Payment processing" : "Payment successful",
      description: response.status === 'pending' 
        ? "We're confirming your payment. This will take just a moment."
        : "Your payment has been processed successfully.",
    });
  };
  
  const handleCancel = () => {
    navigate(-1);
  };
  
  const handlePaymentMethodSelect = (method: any) => {
    setSelectedPaymentMethod(method);
  };
  
  const handleTogglePaymentOption = () => {
    setUseExistingMethod(!useExistingMethod);
  };
  
  const getStatusBadge = () => {
    switch(paymentStatus) {
      case 'pending':
        return (
          <div className="flex items-start bg-yellow-50 border border-yellow-100 rounded-md p-3">
            <Clock className="h-5 w-5 text-yellow-500 mr-2 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-700">Payment Processing</h3>
              <p className="text-sm text-yellow-600">
                We're confirming your payment with the provider...
              </p>
            </div>
          </div>
        );
      case 'success':
        return (
          <div className="flex items-start bg-green-50 border border-green-100 rounded-md p-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mr-2 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-green-700">Payment Successful</h3>
              <p className="text-sm text-green-600">
                Payment ID: {paymentDetails?.paymentId}<br/>
                Redirecting you to dashboard...
              </p>
            </div>
          </div>
        );
      case 'failed':
        return (
          <div className="flex items-start bg-red-50 border border-red-100 rounded-md p-3">
            <AlertCircle className="h-5 w-5 text-red-500 mr-2 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-700">Payment Failed</h3>
              <p className="text-sm text-red-600">
                There was an issue processing your payment. Please try again.
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
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
            
            {paymentStatus && (
              <Card className="mb-6">
                <CardContent className="pt-4">
                  {getStatusBadge()}
                </CardContent>
              </Card>
            )}
            
            {!paymentComplete && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Your Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <Button 
                      variant={useExistingMethod ? "default" : "outline"} 
                      className="mr-2"
                      onClick={handleTogglePaymentOption}
                    >
                      Use Saved Method
                    </Button>
                    <Button 
                      variant={!useExistingMethod ? "default" : "outline"}
                      onClick={handleTogglePaymentOption}
                    >
                      New Payment
                    </Button>
                  </div>
                  
                  {useExistingMethod && (
                    <PaymentMethodList 
                      paymentMethods={paymentMethods} 
                      selectable={true}
                      onSelect={handlePaymentMethodSelect}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </div>
          
          <div>
            {(!useExistingMethod || !selectedPaymentMethod) ? (
              <PaymentForm 
                amount={amount + 5} 
                onSuccess={handlePaymentSuccess} 
                onCancel={handleCancel}
              />
            ) : (
              <Card className="w-full max-w-md mx-auto">
                <CardHeader>
                  <CardTitle>Pay with Saved Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <h3 className="font-medium mb-2">Selected Payment Method</h3>
                    <div className="p-4 border rounded-lg">
                      <p className="font-medium">{selectedPaymentMethod.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedPaymentMethod.type === "card" ? (
                          <>Card Number: {selectedPaymentMethod.number} • Expires: {selectedPaymentMethod.expiry}</>
                        ) : (
                          <>Account Number: {selectedPaymentMethod.number} • Branch: {selectedPaymentMethod.branch}</>
                        )}
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-4 border-b">
                      <span className="font-medium">Total Amount</span>
                      <span className="font-bold">{formatCurrency(amount + 5)}</span>
                    </div>
                    
                    <Button 
                      className="w-full" 
                      onClick={() => {
                        handlePaymentSuccess({
                          paymentId: `PM-${Math.floor(100000 + Math.random() * 900000)}`,
                          method: selectedPaymentMethod.type === "card" ? 
                            `card_${selectedPaymentMethod.name.split(" ")[0].toLowerCase()}` : 
                            `bank_${selectedPaymentMethod.name.split(" ")[0].toLowerCase()}`,
                          status: "success"
                        });
                      }}
                    >
                      Pay {formatCurrency(amount + 5)}
                    </Button>
                    
                    <Button variant="outline" className="w-full" onClick={handleCancel}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Checkout;
