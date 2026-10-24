
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const UssdAccess = () => {
  const [provider, setProvider] = useState("mtn");
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const { toast } = useToast();

  // USSD payments are NOT live: no telco integration is connected, and the
  // previous flow only recorded a pending transaction that nothing ever
  // settled. Submission is disabled so no one is told to dial a code that
  // cannot complete a payment. No money is taken.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "USSD payments are not live yet",
      description: "No USSD provider is connected, so no code can be generated and no money will be taken.",
      variant: "destructive",
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">USSD Payment</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Generate USSD Code</CardTitle>
                <CardDescription>
                  USSD payments are not live yet — no telco integration is connected
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Not available yet</AlertTitle>
                  <AlertDescription>
                    USSD payments are not live yet. Code generation is disabled because a generated
                    code would not complete a real payment. No money will be taken.
                  </AlertDescription>
                </Alert>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="provider">Mobile Network</Label>
                    <Select
                      value={provider}
                      onValueChange={setProvider}
                      disabled
                    >
                      <SelectTrigger id="provider">
                        <SelectValue placeholder="Select network" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mtn">MTN</SelectItem>
                        <SelectItem value="airtel">Airtel</SelectItem>
                        <SelectItem value="zamtel">Zamtel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        K
                      </span>
                      <Input
                        id="amount"
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="pl-8"
                        placeholder="0.00"
                        min="1"
                        step="0.01"
                        disabled
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber">Mobile Money Phone Number</Label>
                    <Input
                      id="phoneNumber"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. 0971234567"
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      When USSD payments launch, the payment prompt will be sent to this number.
                    </p>
                  </div>
                  
                  <Button
                    type="submit"
                    className="w-full"
                    disabled
                  >
                    Generate USSD Code (not yet available)
                  </Button>
                </form>
                
              </CardContent>
            </Card>
          </div>
          
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>How USSD Payments Work</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm list-decimal pl-4">
                  <li>Generate a USSD code from this page</li>
                  <li>Dial the code on your phone</li>
                  <li>Follow the instructions on your phone</li>
                  <li>Enter your PIN when prompted</li>
                  <li>Confirm the payment</li>
                </ol>

                <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
                  <p>This is how USSD payments will work once a mobile network integration is connected. The feature is not live yet.</p>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Supported Networks</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  <li className="flex items-center">
                    <div className="w-6 h-6 rounded-full bg-yellow-500 mr-2"></div>
                    <span>MTN — planned</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-6 h-6 rounded-full bg-red-500 mr-2"></div>
                    <span>Airtel — planned</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-6 h-6 rounded-full bg-green-500 mr-2"></div>
                    <span>Zamtel — planned</span>
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground mt-3">No network is connected yet; USSD access codes will be published here when the service launches.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default UssdAccess;
