
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const UpdatePassword = () => {
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { updateUserPassword } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Form validation schema
  const passwordSchema = z.object({
    password: z.string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string(),
  }).refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
  
  // Create form
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });
  
  const handleSubmit = async (values: z.infer<typeof passwordSchema>) => {
    try {
      setLoading(true);
      await updateUserPassword(values.password);
      setIsSuccess(true);
      
      // Redirect to login after a delay
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Password update failed",
        description: error.message,
        variant: "destructive",
      });
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
              {isSuccess ? (
                <ShieldCheck className="text-green-600 h-6 w-6" />
              ) : (
                <KeyRound className="text-primary h-6 w-6" />
              )}
            </div>
            <CardTitle className="text-2xl font-bold text-center">
              {isSuccess ? "Password Updated!" : "Create New Password"}
            </CardTitle>
            <CardDescription className="text-center">
              {isSuccess 
                ? "Your password has been successfully updated." 
                : "Set a strong, unique password for your account."}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {isSuccess ? (
              <div className="text-center space-y-4">
                <p>You can now log in with your new password.</p>
                <p className="text-sm text-muted-foreground">Redirecting you to login page...</p>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input 
                              type={showPassword ? "text" : "password"} 
                              {...field} 
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="pt-2">
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "Updating Password..." : "Update Password"}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
          
          {!isSuccess && (
            <CardFooter className="flex flex-col space-y-2">
              <Button 
                variant="link" 
                onClick={() => navigate('/login')}
                className="text-sm"
              >
                Return to login
              </Button>
            </CardFooter>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default UpdatePassword;
