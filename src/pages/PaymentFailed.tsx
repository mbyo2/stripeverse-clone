
import React from "react";
import { useLocation, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PaymentFailed = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  
  // Extract error details from query params
  const errorCode = queryParams.get("code") || "ERR_PAYMENT_FAILED";
  const errorMessage = queryParams.get("message") || "Your payment could not be processed. Please try again or contact support.";
  const transactionId = queryParams.get("txid") || "TX" + Math.floor(Math.random() * 1000000);
  
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              
              <h1 className="text-2xl font-bold mb-2">Payment Failed</h1>
              <p className="text-muted-foreground mb-6">
                {errorMessage}
              </p>
              
              <div className="w-full bg-secondary/10 rounded-lg p-4 mb-6">
                <dl className="divide-y">
                  <div className="py-2 flex justify-between">
                    <dt className="text-muted-foreground">Error Code</dt>
                    <dd className="font-medium">{errorCode}</dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-muted-foreground">Transaction ID</dt>
                    <dd className="font-medium">{transactionId}</dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-muted-foreground">Date & Time</dt>
                    <dd className="font-medium">{new Date().toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
              
              <div className="space-y-4 w-full">
                <Button className="w-full" asChild>
                  <Link to="/checkout">Try Again</Link>
                </Button>
                <div className="flex flex-col space-y-2">
                  <Button variant="outline" asChild>
                    <Link to="/contact">Contact Support</Link>
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link to="/">Return to Home</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default PaymentFailed;
