
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, Landmark, PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface PaymentMethod {
  id: number;
  type: string;
  name: string;
  number: string;
  expiry?: string;
  branch?: string;
}

interface PaymentMethodListProps {
  paymentMethods: PaymentMethod[];
  onSelect?: (method: PaymentMethod) => void;
  selectable?: boolean;
}

const PaymentMethodList = ({ 
  paymentMethods, 
  onSelect,
  selectable = false 
}: PaymentMethodListProps) => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { toast } = useToast();

  const handleSelect = (method: PaymentMethod) => {
    setSelectedId(method.id);
    if (onSelect) {
      onSelect(method);
    }
  };

  const handleDelete = (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    
    // In a real app, this would call an API to delete the payment method
    toast({
      title: "Payment method removed",
      description: "The payment method has been deleted from your account."
    });
  };

  const handleAddMethod = () => {
    // In a real app, this would navigate to an add payment method page
    toast({
      title: "Add payment method",
      description: "This would open a form to add a new payment method."
    });
  };

  return (
    <div className="grid gap-4">
      {paymentMethods.map((method) => (
        <Card 
          key={method.id}
          className={`transition-all ${selectable ? 'cursor-pointer hover:shadow-md' : ''} ${
            selectedId === method.id ? 'border-primary bg-primary/5' : ''
          }`}
          onClick={selectable ? () => handleSelect(method) : undefined}
        >
          <CardContent className="p-4 flex items-center">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mr-4">
              {method.type === "card" ? (
                <CreditCard className="h-5 w-5 text-primary" />
              ) : (
                <Landmark className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="flex-1">
              <h3 className="font-medium">{method.name}</h3>
              <p className="text-sm text-muted-foreground">
                {method.type === "card" ? (
                  <>Card Number: {method.number} • Expires: {method.expiry}</>
                ) : (
                  <>Account Number: {method.number} • Branch: {method.branch}</>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {selectedId === method.id && selectable && (
                <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-white"></div>
                </div>
              )}
              
              <Button 
                variant="ghost" 
                size="sm"
                onClick={(e) => handleDelete(method.id, e)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      
      <Button variant="outline" className="mt-2" onClick={handleAddMethod}>
        <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Method
      </Button>
    </div>
  );
};

export default PaymentMethodList;
