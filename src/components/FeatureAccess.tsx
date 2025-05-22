
import { useRoles, Feature } from "@/contexts/RoleContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, LockIcon, UnlockIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface FeatureStatusProps {
  feature: Feature;
  name: string;
  description: string;
  link?: string;
}

export const FeatureStatus = ({ feature, name, description, link }: FeatureStatusProps) => {
  const { hasAccess } = useRoles();
  const isAccessible = hasAccess(feature);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className={`transition-all hover:shadow ${isAccessible ? 'border-green-500/20 hover:shadow-green-500/5' : 'border-amber-500/20 hover:shadow-amber-500/5'}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center">
                {isAccessible ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 mr-3" />
                ) : (
                  <LockIcon className="h-5 w-5 text-amber-500 mr-3" />
                )}
                <div>
                  <h3 className="font-medium">{name}</h3>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              {link && isAccessible && (
                <Link to={link}>
                  <Button variant="outline" size="sm">Access</Button>
                </Link>
              )}
              {!isAccessible && (
                <Link to="/pricing">
                  <Button variant="outline" size="sm" className="text-amber-600">Upgrade</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent>
          {isAccessible ? (
            <p>Feature available with your current plan</p>
          ) : (
            <p>Upgrade your plan to access this feature</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const RoleBadge = () => {
  const { roles, subscriptionTier } = useRoles();
  
  const getRoleColor = () => {
    if (roles.includes("admin")) return "bg-purple-500";
    if (roles.includes("business")) return "bg-blue-500";
    if (roles.includes("beta_tester")) return "bg-amber-500";
    return "bg-gray-500";
  };

  const getTierColor = () => {
    switch (subscriptionTier) {
      case "enterprise": return "bg-purple-500";
      case "premium": return "bg-blue-500";
      case "basic": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  const getHighestRole = () => {
    if (roles.includes("admin")) return "Admin";
    if (roles.includes("business")) return "Business";
    if (roles.includes("beta_tester")) return "Beta Tester";
    return "User";
  };

  const getTierName = () => {
    switch (subscriptionTier) {
      case "enterprise": return "Enterprise";
      case "premium": return "Premium";
      case "basic": return "Basic";
      default: return "Free";
    }
  };

  return (
    <div className="flex gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`px-2 py-1 rounded-full text-white text-xs font-medium ${getRoleColor()}`}>
              {getHighestRole()}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Your account role</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`px-2 py-1 rounded-full text-white text-xs font-medium ${getTierColor()}`}>
              {getTierName()}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Your subscription tier</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export const FeatureList = () => {
  const features: { id: Feature; name: string; description: string; link?: string }[] = [
    { 
      id: "virtual_cards", 
      name: "Virtual Cards", 
      description: "Create and manage virtual debit cards", 
      link: "/card/new" 
    },
    { 
      id: "transfers", 
      name: "Money Transfers", 
      description: "Send money locally and internationally", 
      link: "/transfer" 
    },
    { 
      id: "business_tools", 
      name: "Business Tools", 
      description: "Advanced tools for businesses", 
      link: "/business" 
    },
    { 
      id: "analytics", 
      name: "Analytics", 
      description: "Transaction analytics and reports", 
      link: "/transactions" 
    },
    { 
      id: "feedback_dashboard", 
      name: "Feedback Management", 
      description: "Manage customer feedback", 
      link: "/feedback-dashboard" 
    }
  ];

  return (
    <div className="space-y-2">
      {features.map((feature) => (
        <FeatureStatus
          key={feature.id}
          feature={feature.id}
          name={feature.name}
          description={feature.description}
          link={feature.link}
        />
      ))}
      <div className="mt-4 text-center">
        <Link to="/pricing">
          <Button variant="outline">View All Subscription Tiers</Button>
        </Link>
      </div>
    </div>
  );
};
