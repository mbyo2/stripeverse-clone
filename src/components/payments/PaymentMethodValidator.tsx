import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface PaymentMethodValidationResult {
  method: string;
  provider: string;
  isValid: boolean;
  lastChecked: Date;
  errors: string[];
  capabilities: string[];
}

interface PaymentMethodValidatorProps {
  paymentMethods: Array<{
    id: string;
    type: string;
    provider: string;
    isVerified: boolean;
  }>;
  onValidate: (methodId: string) => Promise<PaymentMethodValidationResult>;
}

const PaymentMethodValidator: React.FC<PaymentMethodValidatorProps> = ({ 
  paymentMethods, 
  onValidate 
}) => {
  const [validationResults, setValidationResults] = useState<Record<string, PaymentMethodValidationResult>>({});
  const [validatingMethods, setValidatingMethods] = useState<Set<string>>(new Set());

  const handleValidateMethod = async (methodId: string) => {
    setValidatingMethods(prev => new Set(prev).add(methodId));
    
    try {
      const result = await onValidate(methodId);
      setValidationResults(prev => ({
        ...prev,
        [methodId]: result
      }));
    } catch (error) {
      console.error('Validation failed:', error);
    } finally {
      setValidatingMethods(prev => {
        const newSet = new Set(prev);
        newSet.delete(methodId);
        return newSet;
      });
    }
  };

  const getValidationIcon = (result?: PaymentMethodValidationResult) => {
    if (!result) return <AlertCircle className="h-4 w-4 text-gray-400" />;
    
    return result.isValid 
      ? <CheckCircle className="h-4 w-4 text-green-500" />
      : <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getValidationBadge = (result?: PaymentMethodValidationResult) => {
    if (!result) return <Badge variant="outline">Not Validated</Badge>;
    
    return result.isValid 
      ? <Badge className="bg-green-100 text-green-800">Valid</Badge>
      : <Badge variant="destructive">Invalid</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Method Validation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {paymentMethods.map((method) => {
            const result = validationResults[method.id];
            const isValidating = validatingMethods.has(method.id);
            
            return (
              <div 
                key={method.id} 
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {getValidationIcon(result)}
                  <div>
                    <div className="font-medium">
                      {method.type.charAt(0).toUpperCase() + method.type.slice(1)} - {method.provider}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {result?.lastChecked 
                        ? `Last validated: ${result.lastChecked.toLocaleString()}`
                        : 'Never validated'
                      }
                    </div>
                    {result?.errors && result.errors.length > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {result.errors.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  {getValidationBadge(result)}
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleValidateMethod(method.id)}
                    disabled={isValidating}
                  >
                    {isValidating ? (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                        Validating
                      </>
                    ) : (
                      'Validate'
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
          
          {paymentMethods.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No payment methods configured
            </div>
          )}
        </div>
        
        {paymentMethods.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <Button
              onClick={() => {
                paymentMethods.forEach(method => {
                  if (!validatingMethods.has(method.id)) {
                    handleValidateMethod(method.id);
                  }
                });
              }}
              disabled={validatingMethods.size > 0}
              className="w-full"
            >
              {validatingMethods.size > 0 ? 'Validating...' : 'Validate All Methods'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentMethodValidator;