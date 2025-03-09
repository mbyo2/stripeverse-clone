
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PaymentForm from "@/components/PaymentForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, Clock, AlertCircle, CreditCard, Building, Smartphone } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PaymentDetails {
  paymentId: string;
  method: string;
  status: string;
}

const Checkout = () => {
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'failed' | null>(null);
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
      }, 3000);
      
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
  
  const getPaymentMethodIcon = (method: string) => {
    if (method.startsWith('card_')) {
      return <CreditCard className="text-2xl" />;
    } else if (method.startsWith('bank_')) {
      return <Building className="text-2xl" />;
    } else {
      return <Smartphone className="text-2xl" />;
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
            
            <Card className="bg-blue-50 border-blue-100">
              <CardContent className="pt-6">
                <h3 className="font-medium text-blue-800 mb-2">Available Payment Methods</h3>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {/* Mobile Money Providers */}
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">📱</div>
                    <div className="text-sm font-medium">MTN</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">📱</div>
                    <div className="text-sm font-medium">Airtel</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">📱</div>
                    <div className="text-sm font-medium">Zamtel</div>
                  </div>
                  
                  {/* Banks */}
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">🏦</div>
                    <div className="text-sm font-medium">Zanaco</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">🏦</div>
                    <div className="text-sm font-medium">Stanbic</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">🏦</div>
                    <div className="text-sm font-medium">ABSA</div>
                  </div>
                  
                  {/* Card Types */}
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">💳</div>
                    <div className="text-sm font-medium">Visa</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">💳</div>
                    <div className="text-sm font-medium">MasterCard</div>
                  </div>
                  <div className="border rounded-md p-2 text-center bg-white">
                    <div className="text-2xl mb-1">💳</div>
                    <div className="text-sm font-medium">AmEx</div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <p className="text-sm text-blue-700">
                    For testing mobile payment providers, use these prefixes:
                  </p>
                  <ul className="text-xs text-blue-600 list-disc pl-5">
                    <li>MTN: 076, 077, 078</li>
                    <li>Airtel: 095, 096, 097</li>
                    <li>Zamtel: 050, 051, 052</li>
                  </ul>
                  
                  <p className="text-sm text-blue-700 mt-2">
                    For testing card payments:
                  </p>
                  <ul className="text-xs text-blue-600 list-disc pl-5">
                    <li>Visa: 4242 4242 4242 4242</li>
                    <li>MasterCard: 5555 5555 5555 4444</li>
                    <li>AmEx: 3782 822463 10005</li>
                    <li>Discover: 6011 0000 0000 0004</li>
                    <li>JCB: 3566 0020 2036 0505</li>
                  </ul>
                  
                  <p className="text-sm text-blue-700 mt-2">
                    For testing bank transfers:
                  </p>
                  <ul className="text-xs text-blue-600 list-disc pl-5">
                    <li>Zanaco: 10-digit account number</li>
                    <li>Stanbic: 11-digit account number</li>
                    <li>ABSA: 12-digit account number</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
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
