import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ArrowRight, Wallet, Shield, User, CreditCard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action: string;
  route: string;
  completed: boolean;
}

interface OnboardingWizardProps {
  kycLevel: string;
  walletBalance: number;
  hasProfile: boolean;
  onDismiss: () => void;
}

const OnboardingWizard = ({ kycLevel, walletBalance, hasProfile, onDismiss }: OnboardingWizardProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const steps: OnboardingStep[] = [
    {
      id: "profile",
      title: "Complete Your Profile",
      description: "Add your name and phone number for a personalized experience.",
      icon: <User className="h-6 w-6" />,
      action: "Go to Settings",
      route: "/settings",
      completed: hasProfile,
    },
    {
      id: "kyc",
      title: "Verify Your Identity",
      description: "Complete KYC verification to unlock all features and higher limits.",
      icon: <Shield className="h-6 w-6" />,
      action: "Start Verification",
      route: "/kyc",
      completed: kycLevel !== "none",
    },
    {
      id: "deposit",
      title: "Fund Your Wallet",
      description: "Add funds to start sending money, paying bills, and more.",
      icon: <Wallet className="h-6 w-6" />,
      action: "Deposit Now",
      route: "/wallet",
      completed: walletBalance > 0,
    },
    {
      id: "card",
      title: "Get a Virtual Card",
      description: "Create a virtual card for online payments and subscriptions.",
      icon: <CreditCard className="h-6 w-6" />,
      action: "Create Card",
      route: "/card/new",
      completed: false, // Will be checked dynamically if needed
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progress = (completedCount / steps.length) * 100;

  if (completedCount === steps.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="mb-8 border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Welcome! Let's get you started 🚀</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Complete these steps to unlock the full experience
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary">
                {completedCount}/{steps.length} done
              </Badge>
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            </div>
          </div>
          <Progress value={progress} className="mt-3 h-2" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((step, index) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card
                  className={`relative overflow-hidden transition-all hover:shadow-md ${
                    step.completed
                      ? "border-primary/30 bg-primary/5"
                      : "border-border hover:border-primary/20"
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          step.completed
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {step.completed ? (
                          <CheckCircle className="h-6 w-6" />
                        ) : (
                          step.icon
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold">{step.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {step.description}
                        </p>
                        {!step.completed && (
                          <Button
                            variant="link"
                            size="sm"
                            className="px-0 mt-2 h-auto text-xs"
                            onClick={() => navigate(step.route)}
                          >
                            {step.action}
                            <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default OnboardingWizard;
