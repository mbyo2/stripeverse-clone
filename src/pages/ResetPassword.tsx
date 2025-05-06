
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const ResetPassword = () => {
  const [email, setEmail] = useState("");
  const [showRequestForm, setShowRequestForm] = useState(true);
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await resetPassword(email);
      setShowRequestForm(false);
    } catch (error) {
      console.error("Reset password error:", error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 pt-24">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="text-primary h-6 w-6" />
            </div>
            <CardTitle className="text-2xl font-bold text-center">Reset your password</CardTitle>
            <CardDescription className="text-center">
              {showRequestForm 
                ? "Enter your email address and we'll send you a link to reset your password." 
                : "Check your email for a password reset link."}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {showRequestForm ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending reset link..." : "Send reset link"}
                </Button>
              </form>
            ) : (
              <div className="space-y-4 text-center">
                <p>
                  We've sent a password reset link to <strong>{email}</strong>.
                </p>
                <p>
                  Please check your email inbox. If you don't see it, check your spam folder as well.
                </p>
              </div>
            )}
          </CardContent>
          
          <CardFooter className="flex flex-col space-y-2">
            <Button 
              variant="link" 
              onClick={() => navigate('/login')}
              className="text-sm"
            >
              Return to login
            </Button>
          </CardFooter>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default ResetPassword;
