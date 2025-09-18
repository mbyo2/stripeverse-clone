import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Shield, Lock } from "lucide-react";
import { useToast } from '@/hooks/use-toast';

interface SecureCardViewerProps {
  cardId: string;
  maskedNumber: string;
  provider: string;
  onSecureAccess?: (cardId: string) => void;
}

const SecureCardViewer: React.FC<SecureCardViewerProps> = ({
  cardId,
  maskedNumber,
  provider,
  onSecureAccess
}) => {
  const [isAccessing, setIsAccessing] = useState(false);
  const { toast } = useToast();

  const handleSecureAccess = useCallback(async () => {
    setIsAccessing(true);
    
    try {
      // Log security event for card access
      console.log(`Secure card access requested for card: ${cardId}`);
      
      // Show security warning
      toast({
        title: "Secure Card Access",
        description: "This action is logged for security monitoring.",
      });

      // Call parent handler if provided
      onSecureAccess?.(cardId);
      
      // Simulate secure access delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      toast({
        title: "Access Denied",
        description: "Unable to access card details securely.",
        variant: "destructive"
      });
    } finally {
      setIsAccessing(false);
    }
  }, [cardId, onSecureAccess, toast]);

  return (
    <Card className="border-2 border-green-200 bg-green-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4 text-green-600" />
          Secure Card Display
          <Badge variant="outline" className="text-xs">
            {provider.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-lg">{maskedNumber}</span>
            <Lock className="h-4 w-4 text-green-600" />
          </div>
          <div className="text-sm text-muted-foreground">
            CVV: *** | Exp: **/**
          </div>
        </div>
        
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-4 w-4 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              Security Notice
            </span>
          </div>
          <p className="text-xs text-yellow-700">
            Card details are encrypted and stored securely. Full card details 
            are not displayed for security reasons.
          </p>
        </div>

        <Button 
          size="sm" 
          variant="outline"
          onClick={handleSecureAccess}
          disabled={isAccessing}
          className="w-full"
        >
          {isAccessing ? (
            <>
              <Lock className="mr-2 h-4 w-4 animate-pulse" />
              Accessing Securely...
            </>
          ) : (
            <>
              <Shield className="mr-2 h-4 w-4" />
              Request Secure Access
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default SecureCardViewer;