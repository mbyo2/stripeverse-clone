
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Copy, Smartphone } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface UssdPaymentProps {
  amount: number;
  onSuccess: (response: { paymentId: string; method: string; status: string }) => void;
  onCancel: () => void;
}

const ussdProviders = [
  { 
    id: "mtn", 
    name: "MTN Mobile Money",
    code: "*126#",
    instructions: [
      "Dial *126#",
      "Select option 4 (Pay Bill)",
      "Enter Merchant Code: 78912",
      "Enter Reference Number: {reference}",
      "Enter Amount: {amount}",
      "Enter PIN to confirm"
    ]
  },
  { 
    id: "airtel", 
    name: "Airtel Money",
    code: "*115#",
    instructions: [
      "Dial *115#",
      "Select option 3 (Make Payments)",
      "Select option 1 (Pay Merchant)",
      "Enter Business Number: 654321",
      "Enter Reference Number: {reference}",
      "Enter Amount: {amount}",
      "Enter PIN to confirm"
    ]
  },
  { 
    id: "zamtel", 
    name: "Zamtel Kwacha",
    code: "*344#",
    instructions: [
      "Dial *344#",
      "Select option 2 (Payments)",
      "Enter Merchant Code: 24680",
      "Enter Reference Number: {reference}",
      "Enter Amount: {amount}",
      "Enter PIN to confirm"
    ]
  }
];

const UssdPayment = ({ amount, onSuccess, onCancel }: UssdPaymentProps) => {
  const [provider, setProvider] = useState("");
  const [reference, setReference] = useState(`REF${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCopyCode = () => {
    const selectedProvider = ussdProviders.find(p => p.id === provider);
    if (selectedProvider) {
      navigator.clipboard.writeText(selectedProvider.code);
      toast({
        description: `USSD code ${selectedProvider.code} copied to clipboard`,
      });
    }
  };

  const handleConfirm = () => {
    if (!provider) {
      setError("Please select a mobile money provider");
      return;
    }
    
    // Simulate payment verification
    toast({
      title: "Payment registered",
      description: "We'll verify your payment and update your account soon.",
    });
    
    // Call success callback with payment details
    onSuccess({
      paymentId: `USSD-${reference}`,
      method: `ussd_${provider}`,
      status: "pending"
    });
  };

  const getInstructions = () => {
    const selectedProvider = ussdProviders.find(p => p.id === provider);
    if (!selectedProvider) return [];
    
    return selectedProvider.instructions.map(instruction => 
      instruction
        .replace('{reference}', reference)
        .replace('{amount}', amount.toString())
    );
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="space-y-2">
        <Label htmlFor="ussd-provider">Mobile Money Provider</Label>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger id="ussd-provider">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {ussdProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {provider && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium flex items-center">
                  <Smartphone className="mr-2 h-4 w-4" /> USSD Code
                </h3>
                <Button variant="outline" size="sm" onClick={handleCopyCode}>
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
              </div>
              
              <div className="text-center my-4">
                <span className="text-xl font-mono">{ussdProviders.find(p => p.id === provider)?.code}</span>
              </div>
              
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Instructions:</h4>
                <ol className="space-y-2 text-sm pl-5 list-decimal">
                  {getInstructions().map((instruction, index) => (
                    <li key={index}>{instruction}</li>
                  ))}
                </ol>
              </div>
              
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-100 rounded text-sm">
                <p className="text-yellow-800">
                  <strong>Important:</strong> Your reference number is <span className="font-mono">{reference}</span>. 
                  Please use this exact reference when making the payment.
                </p>
              </div>
            </CardContent>
          </Card>
          
          <div className="pt-4 flex justify-between">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>
              I've Completed Payment
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default UssdPayment;
