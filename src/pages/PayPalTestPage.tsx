import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePayPalPayments } from '@/hooks/usePayPalPayments';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function PayPalTestPage() {
  const { processPayment, isProcessing } = usePayPalPayments();
  
  // One-time payment state
  const [paymentAmount, setPaymentAmount] = useState('10.00');
  const [paymentCurrency, setPaymentCurrency] = useState('USD');
  const [paymentDescription, setPaymentDescription] = useState('Test Payment');
  
  // Subscription state
  const [subscriptionPlan, setSubscriptionPlan] = useState('basic');
  const [subscriptionAmount, setSubscriptionAmount] = useState('9.99');
  const [subscriptionCurrency, setSubscriptionCurrency] = useState('USD');
  
  // Results
  const [lastResult, setLastResult] = useState<any>(null);

  const handleOneTimePayment = async () => {
    const result = await processPayment({
      type: 'payment',
      amount: parseFloat(paymentAmount),
      currency: paymentCurrency,
      description: paymentDescription
    });
    setLastResult(result);
  };

  const handleSubscription = async () => {
    const result = await processPayment({
      type: 'subscription',
      amount: parseFloat(subscriptionAmount),
      currency: subscriptionCurrency,
      planId: subscriptionPlan,
      description: `${subscriptionPlan} subscription`
    });
    setLastResult(result);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">PayPal Integration Test</h1>
          <p className="text-muted-foreground mt-2">
            Test PayPal payment flows and integration
          </p>
        </div>

        <Tabs defaultValue="payment" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payment">One-Time Payment</TabsTrigger>
            <TabsTrigger value="subscription">Subscription</TabsTrigger>
          </TabsList>

          <TabsContent value="payment" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Test One-Time Payment</CardTitle>
                <CardDescription>
                  Test the PayPal checkout flow for one-time payments
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="999999.99"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="10.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select value={paymentCurrency} onValueChange={setPaymentCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                      <SelectItem value="EUR">EUR - Euro</SelectItem>
                      <SelectItem value="GBP">GBP - British Pound</SelectItem>
                      <SelectItem value="ZMW">ZMW - Zambian Kwacha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={paymentDescription}
                    onChange={(e) => setPaymentDescription(e.target.value)}
                    placeholder="Payment description"
                  />
                </div>

                <Button 
                  onClick={handleOneTimePayment} 
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Test Payment
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscription" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Test Subscription Payment</CardTitle>
                <CardDescription>
                  Test the PayPal subscription flow
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="plan">Plan</Label>
                  <Select value={subscriptionPlan} onValueChange={setSubscriptionPlan}>
                    <SelectTrigger id="plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic Plan</SelectItem>
                      <SelectItem value="premium">Premium Plan</SelectItem>
                      <SelectItem value="enterprise">Enterprise Plan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sub-amount">Amount</Label>
                  <Input
                    id="sub-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="999999.99"
                    value={subscriptionAmount}
                    onChange={(e) => setSubscriptionAmount(e.target.value)}
                    placeholder="9.99"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sub-currency">Currency</Label>
                  <Select value={subscriptionCurrency} onValueChange={setSubscriptionCurrency}>
                    <SelectTrigger id="sub-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                      <SelectItem value="EUR">EUR - Euro</SelectItem>
                      <SelectItem value="GBP">GBP - British Pound</SelectItem>
                      <SelectItem value="ZMW">ZMW - Zambian Kwacha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  onClick={handleSubscription} 
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Test Subscription
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {lastResult && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {lastResult.success ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    Test Result: Success
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-destructive" />
                    Test Result: Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={lastResult.success ? "default" : "destructive"}>
                  {lastResult.success ? "Success" : "Error"}
                </Badge>
              </div>

              {lastResult.success ? (
                <div className="space-y-2">
                  {lastResult.orderId && (
                    <div className="text-sm">
                      <span className="font-medium">Order ID:</span>{' '}
                      <code className="bg-muted px-2 py-1 rounded">{lastResult.orderId}</code>
                    </div>
                  )}
                  {lastResult.subscriptionId && (
                    <div className="text-sm">
                      <span className="font-medium">Subscription ID:</span>{' '}
                      <code className="bg-muted px-2 py-1 rounded">{lastResult.subscriptionId}</code>
                    </div>
                  )}
                  {lastResult.approvalUrl && (
                    <div className="text-sm">
                      <span className="font-medium">Approval URL:</span>{' '}
                      <a 
                        href={lastResult.approvalUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-all"
                      >
                        {lastResult.approvalUrl}
                      </a>
                    </div>
                  )}
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Payment initiated successfully. A new tab should have opened with PayPal checkout.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {lastResult.error || 'Unknown error occurred'}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Test Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Test one-time payment with different amounts</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Test subscription creation for all plans</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Verify webhook handling after payment completion</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Test error handling with invalid amounts</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Test currency validation</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Verify database records created correctly</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}