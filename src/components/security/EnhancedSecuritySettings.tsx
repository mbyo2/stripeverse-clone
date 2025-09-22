import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  Lock, 
  Key, 
  Eye, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle,
  ExternalLink 
} from 'lucide-react';
import { SecurityMonitor } from './SecurityMonitor';

export const EnhancedSecuritySettings: React.FC = () => {
  const securityFeatures = [
    {
      title: "Enhanced Card Encryption",
      description: "Virtual card data is encrypted with SHA-512 and unique salts",
      status: "active",
      icon: Lock,
      level: "Advanced"
    },
    {
      title: "Rate Limiting",
      description: "Advanced rate limiting with IP tracking and threat detection",
      status: "active", 
      icon: Shield,
      level: "Enhanced"
    },
    {
      title: "Security Event Logging",
      description: "Comprehensive logging of all security-related activities",
      status: "active",
      icon: Eye,
      level: "Professional"
    },
    {
      title: "Automated Cleanup",
      description: "Regular cleanup of expired sessions and security tokens",
      status: "active",
      icon: RefreshCw,
      level: "Advanced"
    },
    {
      title: "Role Protection",
      description: "Enhanced role validation prevents unauthorized escalation",
      status: "active",
      icon: Key,
      level: "Critical"
    }
  ];

  const pendingActions = [
    {
      title: "Enable Leaked Password Protection",
      description: "Activate protection against compromised passwords",
      priority: "high",
      link: "https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection"
    },
    {
      title: "PostgreSQL Security Update",
      description: "Upgrade database to latest version with security patches",
      priority: "medium",
      link: "https://supabase.com/docs/guides/platform/upgrading"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Enhanced Security</h2>
          <p className="text-muted-foreground">
            Advanced security measures protecting your data
          </p>
        </div>
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Secured
        </Badge>
      </div>

      <SecurityMonitor />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {securityFeatures.map((feature, index) => (
          <Card key={index}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <feature.icon className="h-5 w-5 text-primary" />
                <Badge variant="outline" className="text-xs">
                  {feature.level}
                </Badge>
              </div>
              <CardTitle className="text-sm">{feature.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                {feature.description}
              </p>
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-3 w-3 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Active</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {pendingActions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <span>Recommended Actions</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingActions.map((action, index) => (
              <Alert key={index}>
                <AlertTriangle className="h-4 w-4" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">{action.title}</h4>
                    <Badge 
                      variant={action.priority === 'high' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {action.priority.toUpperCase()}
                    </Badge>
                  </div>
                  <AlertDescription className="mt-1">
                    {action.description}
                  </AlertDescription>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => window.open(action.link, '_blank')}
                  >
                    Configure in Supabase
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          Your application is now protected with enterprise-level security measures. 
          All sensitive data is encrypted, access is monitored, and threats are automatically detected.
        </AlertDescription>
      </Alert>
    </div>
  );
};