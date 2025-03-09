
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, Landmark, PlusCircle } from "lucide-react";

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
}

const PaymentMethodList = ({ paymentMethods }: PaymentMethodListProps) => {
  return (
    <div className="grid gap-4">
      {paymentMethods.map((method) => (
        <Card key={method.id}>
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
            <Button variant="ghost" size="sm">Edit</Button>
          </CardContent>
        </Card>
      ))}
      
      <Button variant="outline" className="mt-2">
        <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Method
      </Button>
    </div>
  );
};

export default PaymentMethodList;
