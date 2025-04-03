
import React from "react";
import { useLocation, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PaymentSuccess = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  
  // Extract transaction details from query params
  const transactionId = queryParams.get("txid") || "TX" + Math.floor(Math.random() * 1000000);
  const amount = queryParams.get("amount") || "1,200.00";
  const currency = queryParams.get("currency") || "ZMW";
  const recipient = queryParams.get("recipient") || "BMaGlass Pay Merchant";
  
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              
              <h1 className="text-2xl font-bold mb-2">Payment Successful!</h1>
              <p className="text-muted-foreground mb-6">
                Your transaction has been processed successfully.
              </p>
              
              <div className="w-full bg-secondary/10 rounded-lg p-4 mb-6">
                <dl className="divide-y">
                  <div className="py-2 flex justify-between">
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium">{currency} {amount}</dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-muted-foreground">Recipient</dt>
                    <dd className="font-medium">{recipient}</dd>
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
              
              <div className="flex flex-col space-y-2 w-full">
                <Button asChild>
                  <Link to="/dashboard">Go to Dashboard</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/">Return to Home</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default PaymentSuccess;
