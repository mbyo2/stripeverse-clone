
import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, ArrowRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshSubscription } = useSubscription();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) {
      // Refresh subscription data after successful payment
      setTimeout(() => {
        refreshSubscription();
      }, 2000);
    }
  }, [sessionId, refreshSubscription]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">Payment Successful!</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                Thank you for your subscription. Your account has been upgraded and you now have access to all the features of your new plan.
              </p>
              
              <div className="space-y-2">
                <Button 
                  onClick={() => navigate('/billing')}
                  className="w-full"
                >
                  View Billing Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                
                <Button 
                  variant="outline"
                  onClick={() => navigate('/dashboard')}
                  className="w-full"
                >
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PaymentSuccess;
