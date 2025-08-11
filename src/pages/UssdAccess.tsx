
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Copy, SmartphoneNfc } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const UssdAccess = () => {
  const [provider, setProvider] = useState("mtn");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [ussdCode, setUssdCode] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const { toast } = useToast();

  const generateRandomReference = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      const newReferenceCode = generateRandomReference();
      setReferenceCode(newReferenceCode);
      
      // Determine the base USSD code for the provider
      let baseUssdCode = "";
      switch(provider) {
        case "mtn":
          baseUssdCode = "*305#";
          break;
        case "airtel":
          baseUssdCode = "*778#";
          break;
        case "zamtel":
          baseUssdCode = "*422#";
          break;
        default:
          baseUssdCode = "*150#";
      }
      
      // Call the Supabase edge function
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'ussd',
          ussdCode: baseUssdCode,
          referenceCode: newReferenceCode,
          amount: parseFloat(amount),
          provider
        }
      });
      
      if (error) throw error;
      
      // Extract the USSD code to dial from the response
      setUssdCode(data.ussdCode);
      
      toast({
        title: "USSD code generated",
        description: "Dial the code on your phone to complete the payment",
      });
      
    } catch (error) {
      console.error("Error processing USSD payment:", error);
      toast({
        title: "Failed to generate USSD code",
        description: "There was an error processing your request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyClick = () => {
    navigator.clipboard.writeText(ussdCode);
    toast({
      title: "Copied to clipboard",
      description: "USSD code has been copied to your clipboard",
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">USSD Payment</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Generate USSD Code</CardTitle>
                <CardDescription>
                  Generate a USSD code that you can dial on your phone to complete a payment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="provider">Mobile Network</Label>
                    <Select 
                      value={provider} 
                      onValueChange={setProvider}
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
                        required
                      />
                    </div>
                  </div>
                  
                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={loading}
                  >
                    {loading ? "Processing..." : "Generate USSD Code"}
                  </Button>
                </form>
                
                {ussdCode && (
                  <div className="mt-6 space-y-4">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Payment Instructions</AlertTitle>
                      <AlertDescription>
                        Dial this code on your phone to complete the payment. Reference: {referenceCode}
                      </AlertDescription>
                    </Alert>
                    
                    <div className="flex items-center justify-between p-4 border rounded-md bg-secondary/20">
                      <div className="flex items-center">
                        <SmartphoneNfc className="h-5 w-5 mr-2 text-primary" />
                        <span className="text-xl font-mono">{ussdCode}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleCopyClick}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </Button>
                    </div>
                    
                    <p className="text-sm text-muted-foreground">
                      After dialing the code, follow the prompts on your phone to complete the payment.
                      Your transaction reference is: <strong>{referenceCode}</strong>
                    </p>
                  </div>
                )}
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
                  <p>USSD payments are processed directly through your mobile network provider.</p>
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
                    <span>MTN - *305#</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-6 h-6 rounded-full bg-red-500 mr-2"></div>
                    <span>Airtel - *778#</span>
                  </li>
                  <li className="flex items-center">
                    <div className="w-6 h-6 rounded-full bg-green-500 mr-2"></div>
                    <span>Zamtel - *422#</span>
                  </li>
                </ul>
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
