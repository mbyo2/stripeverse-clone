
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Check, Shield } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface CardPaymentProps {
  amount: number;
  onSuccess: (response: { paymentId: string; method: string; status: string }) => void;
  onCancel: () => void;
}

const CardPayment = ({ amount, onSuccess, onCancel }: CardPaymentProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvv, setCvv] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const formatCardNumber = (input: string) => {
    // Remove all non-digit characters
    const digits = input.replace(/\D/g, "");
    
    // Limit to 16 digits
    const limitedDigits = digits.slice(0, 16);
    
    // Format with spaces every 4 digits
    const formatted = limitedDigits.replace(/(\d{4})(?=\d)/g, "$1 ");
    
    return formatted;
  };

  const formatExpiryDate = (input: string) => {
    // Remove all non-digit characters
    const digits = input.replace(/\D/g, "");
    
    // Limit to 4 digits
    const limitedDigits = digits.slice(0, 4);
    
    // Format as MM/YY
    if (limitedDigits.length > 2) {
      return `${limitedDigits.slice(0, 2)}/${limitedDigits.slice(2)}`;
    }
    
    return limitedDigits;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!cardNumber.trim()) {
      newErrors.cardNumber = "Card number is required";
    } else if (cardNumber.replace(/\s/g, "").length < 16) {
      newErrors.cardNumber = "Invalid card number";
    }
    
    if (!cardName.trim()) {
      newErrors.cardName = "Cardholder name is required";
    }
    
    if (!expiryDate.trim()) {
      newErrors.expiryDate = "Expiry date is required";
    } else {
      const [month, year] = expiryDate.split("/");
      const currentYear = new Date().getFullYear() % 100;
      const currentMonth = new Date().getMonth() + 1;
      
      if (!month || !year || month.length !== 2 || year.length !== 2) {
        newErrors.expiryDate = "Invalid expiry date format (MM/YY)";
      } else if (parseInt(month) < 1 || parseInt(month) > 12) {
        newErrors.expiryDate = "Invalid month";
      } else if (
        parseInt(year) < currentYear || 
        (parseInt(year) === currentYear && parseInt(month) < currentMonth)
      ) {
        newErrors.expiryDate = "Card has expired";
      }
    }
    
    if (!cvv.trim()) {
      newErrors.cvv = "CVV is required";
    } else if (cvv.length < 3 || cvv.length > 4) {
      newErrors.cvv = "CVV must be 3 or 4 digits";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('process-payment', {
        body: {
          amount,
          currency: 'ZMW',
          paymentMethod: 'card',
          provider: 'visa',
          description: 'Card payment'
        }
      });

      if (error) throw new Error(error.message || 'Payment failed');
      if (!data?.success) throw new Error(data?.error || 'Payment failed');

      toast({
        title: "Payment Successful",
        description: `Your payment of ${formatCurrency(amount)} has been processed successfully.`,
      });

      onSuccess({
        paymentId: data.transaction_id,
        method: 'card',
        status: data.status || 'completed'
      });
      setIsProcessing(false);
    } catch (error) {
      console.error("Error processing card payment:", error);
      toast({
        title: "Payment Failed",
        description: "There was an error processing your payment. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <CreditCard className="h-5 w-5 text-muted-foreground mr-2" />
          <h3 className="font-medium">Card Payment</h3>
        </div>
        <div className="flex items-center bg-primary/10 px-2 py-1 rounded text-xs">
          <Shield className="h-3 w-3 text-primary mr-1" />
          <span>PCI DSS Secure</span>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cardNumber">Card Number</Label>
          <Input
            id="cardNumber"
            placeholder="1234 5678 9012 3456"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            className={errors.cardNumber ? "border-destructive" : ""}
          />
          {errors.cardNumber && (
            <p className="text-sm text-destructive">{errors.cardNumber}</p>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="cardName">Cardholder Name</Label>
          <Input
            id="cardName"
            placeholder="John Doe"
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            className={errors.cardName ? "border-destructive" : ""}
          />
          {errors.cardName && (
            <p className="text-sm text-destructive">{errors.cardName}</p>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="expiryDate">Expiry Date</Label>
            <Input
              id="expiryDate"
              placeholder="MM/YY"
              value={expiryDate}
              onChange={(e) => setExpiryDate(formatExpiryDate(e.target.value))}
              className={errors.expiryDate ? "border-destructive" : ""}
            />
            {errors.expiryDate && (
              <p className="text-sm text-destructive">{errors.expiryDate}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="cvv">CVV</Label>
            <Input
              id="cvv"
              placeholder="123"
              value={cvv}
              onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className={errors.cvv ? "border-destructive" : ""}
            />
            {errors.cvv && (
              <p className="text-sm text-destructive">{errors.cvv}</p>
            )}
          </div>
        </div>
        
        <div className="pt-4 flex justify-between">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isProcessing}>
            {isProcessing ? (
              <>
                <div className="animate-spin mr-2 h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                Processing...
              </>
            ) : (
              `Pay ${formatCurrency(amount)}`
            )}
          </Button>
        </div>
      </form>
      
      <div className="flex items-center justify-center pt-2 text-xs text-muted-foreground">
        <Shield className="h-3 w-3 mr-1" />
        <span>Your payment information is securely processed</span>
      </div>
      
      <div className="flex justify-center gap-2">
        <div className="bg-white p-1 rounded shadow-sm w-10 h-6 flex items-center justify-center">
          <span className="font-bold text-sm text-blue-700">Visa</span>
        </div>
        <div className="bg-white p-1 rounded shadow-sm w-10 h-6 flex items-center justify-center">
          <div className="flex">
            <div className="h-3 w-3 bg-red-500 rounded-full"></div>
            <div className="h-3 w-3 bg-yellow-500 rounded-full -ml-1"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardPayment;
