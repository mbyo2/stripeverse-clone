import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Smartphone } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface MobileMoneyPaymentProps {
  amount: number;
  onSuccess: (response: { paymentId: string; method: string; status: string }) => void;
  onCancel: () => void;
}

const providers = [
  { id: "mtn", name: "MTN Mobile Money", prefixes: ["076", "077", "078"] },
  { id: "airtel", name: "Airtel Money", prefixes: ["095", "096", "097"] },
  { id: "zamtel", name: "Zamtel Kwacha", prefixes: ["050", "051", "052"] },
];

const MobileMoneyPayment = ({ amount, onSuccess, onCancel }: MobileMoneyPaymentProps) => {
  const [provider, setProvider] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const formatPhoneNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only numbers, limit to 12 digits
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 12) {
      value = value.substring(0, 12);
    }
    
    // Format display of phone number
    if (value.startsWith('26') && value.length > 5) {
      // Format as +26 XX XXX XXXX
      value = value.replace(/(\d{2})(\d{2})(\d{3})(\d{4})/, '$1 $2 $3 $4').trim();
    } else if (value.length > 3) {
      // Format as 0XX XXX XXXX
      value = value.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3').trim();
    }
    
    setPhoneNumber(value);
  };

  const validatePhoneNumber = () => {
    if (!phoneNumber) return false;
    
    const digits = phoneNumber.replace(/\D/g, '');
    
    // Check if it's a valid format (either 10 digits starting with 0 or 12 digits starting with 26)
    const isValidFormat = 
      (digits.length === 10 && digits.startsWith('0')) || 
      (digits.length === 12 && digits.startsWith('26'));
    
    if (!isValidFormat) return false;
    
    // Extract the network prefix
    const prefix = digits.startsWith('0') 
      ? digits.substring(1, 3) 
      : digits.substring(3, 5);
    
    // Find the selected provider
    const selectedProvider = providers.find(p => p.id === provider);
    if (!selectedProvider) return false;
    
    // Check if the prefix matches the provider
    return selectedProvider.prefixes.some(p => p.endsWith(prefix));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!provider) {
      setError("Please select a mobile money provider");
      return;
    }
    
    if (!validatePhoneNumber()) {
      setError("Please enter a valid phone number for the selected provider");
      return;
    }
    
    setIsProcessing(true);
    
    try {
      // Call the Supabase Edge Function for processing mobile money
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'mobile-money',
          phoneNumber: phoneNumber.replace(/\D/g, ''),
          amount: amount,
          provider: provider
        }
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to process mobile money payment');
      }
      
      if (data.status === 'failed') {
        throw new Error(data.message || 'Transaction failed');
      }
      
      // Payment successful or pending
      toast({
        title: "Payment request sent",
        description: `Check your ${getProviderName(provider)} phone for payment confirmation.`,
      });
      
      // Call success callback with payment details
      onSuccess({
        paymentId: data.transactionId,
        method: provider,
        status: data.status
      });
      
    } catch (err) {
      console.error('Mobile money payment error:', err);
      setError(err instanceof Error ? err.message : 'Payment processing failed');
      
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : 'Please try again or use another payment method.',
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const getProviderName = (id: string) => {
    const provider = providers.find(p => p.id === id);
    return provider ? provider.name : id;
  };

  const getProviderHelpText = () => {
    if (!provider) return null;
    
    const selectedProvider = providers.find(p => p.id === provider);
    if (!selectedProvider) return null;
    
    return `Valid prefixes: ${selectedProvider.prefixes.join(', ')}`;
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
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="provider">Mobile Money Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="phoneNumber">Mobile Number</Label>
          <Input 
            id="phoneNumber" 
            placeholder="e.g. 097XXXXXXX" 
            value={phoneNumber}
            onChange={formatPhoneNumber}
          />
          <p className="text-sm text-muted-foreground">
            {provider ? getProviderHelpText() : 
              "Enter the mobile number associated with your mobile money account"}
          </p>
        </div>
        
        <div className="pt-4 flex justify-between">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isProcessing}>
            {isProcessing ? "Processing..." : `Pay ${formatCurrency(amount)}`}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default MobileMoneyPayment;
