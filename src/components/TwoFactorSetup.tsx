
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import QRCode from "qrcode.react";

interface TwoFactorSetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

const TwoFactorSetup = ({ onComplete, onCancel }: TwoFactorSetupProps) => {
  const [step, setStep] = useState<'setup' | 'verify' | 'complete'>('setup');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { enable2FA, verify2FA } = useAuth();
  const { toast } = useToast();

  const handleSetup = async () => {
    try {
      setIsLoading(true);
      const result = await enable2FA();
      setQrCode(result.qrCode);
      setSecret(result.secret);
      setStep('verify');
    } catch (error) {
      console.error('2FA setup error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    try {
      setIsLoading(true);
      const isValid = await verify2FA(verificationCode);
      
      if (isValid) {
        setStep('complete');
        toast({
          title: "2FA enabled successfully",
          description: "Your account is now protected with two-factor authentication.",
        });
        setTimeout(() => {
          onComplete?.();
        }, 2000);
      } else {
        toast({
          title: "Invalid code",
          description: "Please check your authenticator app and try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('2FA verification error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'setup') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="text-primary h-6 w-6" />
          </div>
          <CardTitle className="text-center">Enable Two-Factor Authentication</CardTitle>
          <CardDescription className="text-center">
            Add an extra layer of security to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>Two-factor authentication (2FA) adds an extra layer of security to your account.</p>
            <p>You'll need an authenticator app like:</p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Google Authenticator</li>
              <li>Microsoft Authenticator</li>
              <li>Authy</li>
            </ul>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={handleSetup} 
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? "Setting up..." : "Set up 2FA"}
            </Button>
            <Button 
              variant="outline" 
              onClick={onCancel}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'verify') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Scan QR Code</CardTitle>
          <CardDescription className="text-center">
            Use your authenticator app to scan this QR code
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center">
            <QRCode value={qrCode} size={200} />
          </div>
          
          <div className="text-sm">
            <p className="font-medium mb-2">Manual entry key:</p>
            <code className="bg-muted p-2 rounded text-xs break-all block">
              {secret}
            </code>
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Enter verification code</Label>
            <Input
              id="code"
              placeholder="123456"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              maxLength={6}
            />
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={handleVerify} 
              disabled={isLoading || verificationCode.length !== 6}
              className="flex-1"
            >
              {isLoading ? "Verifying..." : "Verify & Enable"}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setStep('setup')}
              className="flex-1"
            >
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-600 h-6 w-6" />
        </div>
        <CardTitle className="text-center text-green-600">2FA Enabled Successfully!</CardTitle>
        <CardDescription className="text-center">
          Your account is now protected with two-factor authentication
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-yellow-600 h-5 w-5 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-800 mb-1">Important:</p>
              <p className="text-yellow-700">
                Make sure to save your backup codes in a secure location. 
                You'll need them if you lose access to your authenticator app.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TwoFactorSetup;
