
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, Clock, AlertCircle, CreditCard } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: 'completed' | 'current' | 'pending';
  action?: {
    label: string;
    path: string;
  };
}

const TierWorkflow = () => {
  const navigate = useNavigate();

  const workflows = {
    upgrade: [
      {
        id: 'select',
        title: 'Select Tier',
        description: 'Choose the subscription tier that fits your needs',
        icon: <CreditCard className="h-5 w-5" />,
        status: 'completed' as const,
        action: { label: 'View Pricing', path: '/pricing' }
      },
      {
        id: 'payment',
        title: 'Payment',
        description: 'Complete payment for your selected tier',
        icon: <CreditCard className="h-5 w-5" />,
        status: 'current' as const,
        action: { label: 'Make Payment', path: '/checkout' }
      },
      {
        id: 'activation',
        title: 'Activation',
        description: 'Your new tier features are activated immediately',
        icon: <CheckCircle className="h-5 w-5" />,
        status: 'pending' as const
      },
      {
        id: 'access',
        title: 'Access Features',
        description: 'Start using your new tier features',
        icon: <ArrowRight className="h-5 w-5" />,
        status: 'pending' as const,
        action: { label: 'Dashboard', path: '/dashboard' }
      }
    ],
    roleRequest: [
      {
        id: 'submit',
        title: 'Submit Request',
        description: 'Request additional role permissions',
        icon: <AlertCircle className="h-5 w-5" />,
        status: 'completed' as const,
        action: { label: 'Request Role', path: '/role-management' }
      },
      {
        id: 'review',
        title: 'Admin Review',
        description: 'Administrator reviews your role request',
        icon: <Clock className="h-5 w-5" />,
        status: 'current' as const
      },
      {
        id: 'approval',
        title: 'Approval',
        description: 'Your role request is approved or declined',
        icon: <CheckCircle className="h-5 w-5" />,
        status: 'pending' as const
      },
      {
        id: 'notification',
        title: 'Notification',
        description: 'You receive notification about the decision',
        icon: <ArrowRight className="h-5 w-5" />,
        status: 'pending' as const
      }
    ],
    featureAccess: [
      {
        id: 'check',
        title: 'Feature Check',
        description: 'System checks your tier and role permissions',
        icon: <CheckCircle className="h-5 w-5" />,
        status: 'completed' as const
      },
      {
        id: 'access',
        title: 'Access Grant',
        description: 'Feature access is granted or restricted',
        icon: <ArrowRight className="h-5 w-5" />,
        status: 'completed' as const
      },
      {
        id: 'usage',
        title: 'Feature Usage',
        description: 'Use the feature within your tier limits',
        icon: <CreditCard className="h-5 w-5" />,
        status: 'current' as const
      },
      {
        id: 'limits',
        title: 'Limit Monitoring',
        description: 'System monitors usage against tier limits',
        icon: <Clock className="h-5 w-5" />,
        status: 'current' as const
      }
    ]
  };

  const getStatusColor = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'current': return 'bg-blue-500';
      case 'pending': return 'bg-gray-300';
      default: return 'bg-gray-300';
    }
  };

  const getStatusBadge = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed': return <Badge className="bg-green-500">Completed</Badge>;
      case 'current': return <Badge className="bg-blue-500">Current</Badge>;
      case 'pending': return <Badge variant="secondary">Pending</Badge>;
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const renderWorkflow = (title: string, steps: WorkflowStep[]) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-full ${getStatusColor(step.status)} flex items-center justify-center text-white flex-shrink-0`}>
                {step.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium">{step.title}</h4>
                  {getStatusBadge(step.status)}
                </div>
                <p className="text-sm text-muted-foreground mb-2">{step.description}</p>
                {step.action && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(step.action!.path)}
                    disabled={step.status === 'pending'}
                  >
                    {step.action.label}
                  </Button>
                )}
              </div>
              {index < steps.length - 1 && (
                <div className="absolute left-5 mt-10 w-0.5 h-8 bg-gray-200" />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Tier & Feature Workflows</h2>
        <p className="text-muted-foreground">
          Understand how tier upgrades, role requests, and feature access work
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {renderWorkflow('Tier Upgrade Process', workflows.upgrade)}
        {renderWorkflow('Role Request Process', workflows.roleRequest)}
        {renderWorkflow('Feature Access Flow', workflows.featureAccess)}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button onClick={() => navigate('/pricing')} className="h-auto p-4 flex flex-col items-center">
              <CreditCard className="h-6 w-6 mb-2" />
              <span className="font-medium">Upgrade Tier</span>
              <span className="text-xs text-muted-foreground">View pricing plans</span>
            </Button>
            <Button onClick={() => navigate('/role-management')} variant="outline" className="h-auto p-4 flex flex-col items-center">
              <AlertCircle className="h-6 w-6 mb-2" />
              <span className="font-medium">Request Role</span>
              <span className="text-xs text-muted-foreground">Get additional permissions</span>
            </Button>
            <Button onClick={() => navigate('/settings')} variant="outline" className="h-auto p-4 flex flex-col items-center">
              <CheckCircle className="h-6 w-6 mb-2" />
              <span className="font-medium">View Features</span>
              <span className="text-xs text-muted-foreground">See available features</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TierWorkflow;
