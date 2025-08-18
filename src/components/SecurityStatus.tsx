import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertTriangle, ExternalLink } from "lucide-react";

const SecurityStatus = () => {
  const fixedItems = [
    "Critical data exposure in subscribers table - Fixed",
    "Enhanced authentication rate limiting - Fixed", 
    "Improved 2FA validation with security logging - Fixed",
    "Enhanced role change validation and audit logging - Fixed",
    "Added comprehensive input validation for payments - Fixed",
    "Implemented proper BTCPay webhook signature verification - Fixed"
  ];

  const pendingItems = [
    {
      title: "Leaked Password Protection",
      description: "Enable leaked password protection in Supabase Auth settings",
      action: "https://supabase.com/dashboard/project/hhxwwozpvgktuqutfkhc/auth/providers",
      priority: "Medium"
    }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Security Fixes Applied
          </CardTitle>
          <CardDescription>
            Critical security vulnerabilities have been resolved
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {fixedItems.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              <span className="text-sm">{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {pendingItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Remaining Actions Required
            </CardTitle>
            <CardDescription>
              These items require manual configuration in your Supabase dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingItems.map((item, index) => (
              <Alert key={index}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-start justify-between">
                    <div>
                      <strong>{item.title}</strong>
                      <p className="text-sm mt-1">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.priority === "High" ? "destructive" : "secondary"}>
                        {item.priority}
                      </Badge>
                      <a 
                        href={item.action} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        Configure <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      <Alert>
        <CheckCircle className="h-4 w-4 text-green-500" />
        <AlertDescription>
          <strong>Security Review Complete:</strong> The most critical vulnerabilities have been patched. 
          Your customer data is now properly protected, authentication is hardened, and input validation 
          is in place. Complete the remaining configuration item to fully secure your application.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default SecurityStatus;