import React, { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CardProcessorIntegration from '@/components/payments/CardProcessorIntegration';
import PaymentMethodValidator from '@/components/payments/PaymentMethodValidator';
import { PaymentStatus } from '@/components/ui/payment-status';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { useRealTimePayments } from '@/hooks/useRealTimePayments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, Settings, Activity } from 'lucide-react';

const PaymentProcessor = () => {
  const { paymentMethods } = usePaymentMethods();
  const { recentPayments } = useRealTimePayments();
  const [processorConfig, setProcessorConfig] = useState(null);

  const handleValidatePaymentMethod = async (methodId: string) => {
    // Real check against the method's stored record: a payment method is
    // valid when it exists and has completed verification. No simulated
    // results — what is stored is what is reported.
    const method = paymentMethods.find(m => m.id === methodId);

    if (!method) {
      return {
        method: 'unknown',
        provider: 'unknown',
        isValid: false,
        lastChecked: new Date(),
        errors: ['Payment method not found'],
        capabilities: [] as string[]
      };
    }

    const isValid = method.is_verified === true;

    return {
      method: method.type || 'unknown',
      provider: method.provider || 'unknown',
      isValid,
      lastChecked: new Date(),
      errors: isValid ? [] : ['Payment method has not completed verification'],
      capabilities: [] as string[]
    };
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Payment Processor Management</h1>
          <p className="text-muted-foreground">
            Configure and manage your payment processing integrations
          </p>
        </div>

        <Tabs defaultValue="integration" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="integration" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Integration
            </TabsTrigger>
            <TabsTrigger value="validation" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Validation
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Monitoring
            </TabsTrigger>
          </TabsList>

          <TabsContent value="integration">
            <CardProcessorIntegration 
              onConfigSave={setProcessorConfig}
            />
          </TabsContent>

          <TabsContent value="validation">
            <PaymentMethodValidator 
              paymentMethods={paymentMethods.map(pm => ({
                id: pm.id,
                type: pm.type,
                provider: pm.provider || 'unknown',
                isVerified: pm.is_verified
              }))}
              onValidate={handleValidatePaymentMethod}
            />
          </TabsContent>

          <TabsContent value="monitoring">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Payment Processing</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {recentPayments.length > 0 ? (
                      recentPayments.map((payment) => (
                        <div 
                          key={payment.id} 
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div>
                            <div className="font-medium">
                              {payment.amount} {payment.currency}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {payment.payment_method} via {payment.provider}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(payment.created_at).toLocaleString()}
                            </div>
                          </div>
                          <PaymentStatus status={payment.status} />
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No recent payment processing activity
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {processorConfig && (
                <Card>
                  <CardHeader>
                    <CardTitle>Current Configuration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div><strong>Provider:</strong> {processorConfig.provider}</div>
                      <div><strong>Environment:</strong> {processorConfig.environment}</div>
                      <div><strong>Features:</strong> {processorConfig.features.join(', ')}</div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default PaymentProcessor;