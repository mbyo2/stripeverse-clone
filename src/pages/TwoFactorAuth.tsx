
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode.react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldCheck, Shield, AlertTriangle, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TwoFactorAuthState {
  isEnabled: boolean;
  secret: string | null;
  backupCodes: string[] | null;  // Make sure this is defined as string[] | null
  qrCodeUrl: string | null;
  isLoading: boolean;
  isVerifying: boolean;
}

// Update this interface to include backup_codes
interface TwoFactorAuthData {
  user_id: string;
  enabled: boolean;
  secret: string | null;
  backup_codes: string[] | null;
  created_at: string;
  updated_at: string;
}

const TwoFactorAuth = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [otp, setOtp] = useState<string>("");
  const [twoFactorState, setTwoFactorState] = useState<TwoFactorAuthState>({
    isEnabled: false,
    secret: null,
    backupCodes: null,
    qrCodeUrl: null,
    isLoading: true,
    isVerifying: false
  });

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    fetchTwoFactorStatus();
  }, [user, navigate]);

  const fetchTwoFactorStatus = async () => {
    try {
      setTwoFactorState(prev => ({ ...prev, isLoading: true }));
      
      // Fetch the user's current 2FA status
      const { data, error } = await supabase
        .from("two_factor_auth")
        .select("*")
        .eq("user_id", user?.id)
        .single();
      
      if (error && error.code !== "PGRST116") {
        throw error;
      }
      
      setTwoFactorState(prev => ({
        ...prev,
        isEnabled: data?.enabled || false,
        secret: data?.secret || null,
        backupCodes: data?.backup_codes as string[] | null,  // Explicitly cast to string[] | null
        isLoading: false
      }));
      
    } catch (error: any) {
      toast({
        title: "Error fetching 2FA status",
        description: error.message,
        variant: "destructive"
      });
      setTwoFactorState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const generateSecret = async () => {
    try {
      setTwoFactorState(prev => ({ ...prev, isLoading: true }));
      
      // In production, you'd call a secure backend endpoint to generate this
      // For this demo, we'll simulate it with a client-side call (NOT RECOMMENDED FOR PRODUCTION)
      const { data, error } = await supabase.functions.invoke('generate-totp-secret', {
        body: { userId: user?.id }
      });
      
      if (error) throw error;
      
      const appName = "BMaGlass Pay";
      const userIdentifier = user?.email || user?.id || 'user';
      const qrCodeUrl = `otpauth://totp/${encodeURIComponent(appName)}:${encodeURIComponent(userIdentifier)}?secret=${data.secret}&issuer=${encodeURIComponent(appName)}`;
      
      setTwoFactorState(prev => ({
        ...prev,
        secret: data.secret,
        qrCodeUrl: qrCodeUrl,
        backupCodes: data.backupCodes as string[],  // Explicitly cast to string[]
        isLoading: false
      }));
      
    } catch (error: any) {
      toast({
        title: "Error generating 2FA secret",
        description: error.message || "Failed to generate 2FA secret",
        variant: "destructive"
      });
      setTwoFactorState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const verifyAndEnableTwoFactor = async () => {
    if (otp.length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter a valid 6-digit code",
        variant: "destructive"
      });
      return;
    }

    try {
      setTwoFactorState(prev => ({ ...prev, isVerifying: true }));
      
      // Verify OTP with edge function
      const { data, error } = await supabase.functions.invoke('verify-totp', {
        body: { 
          userId: user?.id,
          secret: twoFactorState.secret,
          token: otp
        }
      });
      
      if (error || !data.valid) {
        throw new Error(error?.message || "Invalid verification code");
      }
      
      // If valid, store the 2FA configuration
      const { error: updateError } = await supabase
        .from("two_factor_auth")
        .upsert({
          user_id: user?.id,
          enabled: true,
          secret: twoFactorState.secret,
          backup_codes: twoFactorState.backupCodes,
          updated_at: new Date().toISOString()
        });
      
      if (updateError) throw updateError;
      
      setTwoFactorState(prev => ({
        ...prev,
        isEnabled: true,
        isVerifying: false
      }));
      
      toast({
        title: "Two-factor authentication enabled",
        description: "Your account is now more secure!",
      });
      
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive"
      });
      setTwoFactorState(prev => ({ ...prev, isVerifying: false }));
    }
  };

  const disableTwoFactor = async () => {
    try {
      setTwoFactorState(prev => ({ ...prev, isLoading: true }));
      
      const { error } = await supabase
        .from("two_factor_auth")
        .update({
          enabled: false,
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user?.id);
      
      if (error) throw error;
      
      setTwoFactorState(prev => ({
        ...prev,
        isEnabled: false,
        isLoading: false
      }));
      
      toast({
        title: "Two-factor authentication disabled",
        description: "2FA has been turned off for your account"
      });
      
    } catch (error: any) {
      toast({
        title: "Error disabling 2FA",
        description: error.message,
        variant: "destructive"
      });
      setTwoFactorState(prev => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-4xl mx-auto pt-20 px-4">
        <div className="space-y-8 py-8">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-2 rounded-full">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
              <p className="text-muted-foreground">
                Add an extra layer of security to your account
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Account Protection</CardTitle>
              <CardDescription>
                Two-factor authentication adds an additional security layer to your account, requiring both your password and a verification code to log in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {twoFactorState.isEnabled ? (
                <Tabs defaultValue="status">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="status">Status</TabsTrigger>
                    <TabsTrigger value="backup">Backup Codes</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="status" className="space-y-4 pt-4">
                    <Alert className="bg-green-50 border-green-200">
                      <Check className="h-5 w-5 text-green-600" />
                      <AlertTitle>Two-factor authentication is enabled</AlertTitle>
                      <AlertDescription>
                        Your account has enhanced protection. You'll need your authentication app when signing in.
                      </AlertDescription>
                    </Alert>
                    
                    <div className="pt-4">
                      <Button
                        variant="destructive"
                        onClick={disableTwoFactor}
                        disabled={twoFactorState.isLoading}
                      >
                        {twoFactorState.isLoading ? "Processing..." : "Disable Two-Factor Authentication"}
                      </Button>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="backup" className="space-y-4 pt-4">
                    <Alert className="bg-amber-50 border-amber-200">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      <AlertTitle>Keep these codes safe</AlertTitle>
                      <AlertDescription>
                        Use these recovery codes if you lose access to your authentication device. Each code can be used once.
                      </AlertDescription>
                    </Alert>
                    
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {twoFactorState.backupCodes?.map((code, index) => (
                        <div key={index} className="font-mono text-sm bg-muted p-2 rounded border">
                          {code}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              ) : twoFactorState.secret ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="font-medium">Step 1: Scan the QR code or enter the setup key</h3>
                    <p className="text-sm text-muted-foreground">
                      Use an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator to scan this QR code.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start mt-4">
                      <div className="bg-white p-4 rounded-lg border">
                        {twoFactorState.qrCodeUrl && (
                          <QRCode value={twoFactorState.qrCodeUrl} size={180} />
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Can't scan the code?</p>
                        <p className="text-sm text-muted-foreground">
                          Enter this setup key manually in your app:
                        </p>
                        <div className="font-mono text-sm bg-muted p-2 rounded border break-all">
                          {twoFactorState.secret}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2 pt-2 border-t">
                    <h3 className="font-medium pt-2">Step 2: Enter verification code from the app</h3>
                    <p className="text-sm text-muted-foreground">
                      Open your authentication app and enter the 6-digit verification code to verify setup.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-4 items-center pt-2">
                      <div className="w-full sm:w-auto">
                        <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                          </InputOTPGroup>
                          <InputOTPGroup>
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      
                      <Button 
                        onClick={verifyAndEnableTwoFactor} 
                        disabled={otp.length !== 6 || twoFactorState.isVerifying}
                      >
                        {twoFactorState.isVerifying ? "Verifying..." : "Verify and Enable"}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t">
                    <h3 className="font-medium">Backup Codes</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Save these backup codes somewhere safe. You can use them to log in if you lose access to your authentication device.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {twoFactorState.backupCodes?.map((code, index) => (
                        <div key={index} className="font-mono text-sm bg-muted p-2 rounded border">
                          {code}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-start gap-6">
                    <div className="rounded-lg border p-6 flex-1">
                      <h3 className="font-medium text-lg mb-2 flex items-center">
                        <Shield className="h-5 w-5 mr-2 text-primary" />
                        Two-Factor Authentication
                      </h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        Add an extra layer of security to your account by requiring a verification code from your phone in addition to your password.
                      </p>
                      <Button 
                        onClick={generateSecret} 
                        disabled={twoFactorState.isLoading}
                      >
                        {twoFactorState.isLoading ? "Loading..." : "Set Up Two-Factor Auth"}
                      </Button>
                    </div>
                    
                    <div className="rounded-lg border p-6 flex-1">
                      <h3 className="font-medium mb-2">How it works</h3>
                      <ul className="text-sm space-y-2 list-disc pl-5">
                        <li>Set up an authenticator app on your mobile device</li>
                        <li>Scan the QR code or enter the key manually</li>
                        <li>Enter the 6-digit code to verify setup</li>
                        <li>Save your backup codes for account recovery</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col">
              <p className="text-xs text-muted-foreground">
                We recommend using authenticator apps like Google Authenticator, Authy, or Microsoft Authenticator 
                for generating verification codes.
              </p>
            </CardFooter>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TwoFactorAuth;
