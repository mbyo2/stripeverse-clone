
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

const UsageTracker = () => {
  const { subscription, usage, getCurrentTierLimits } = useSubscription();
  
  const currentLimits = getCurrentTierLimits();
  
  if (!subscription || !usage || !currentLimits) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-2 bg-gray-200 rounded"></div>
            <div className="h-2 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getUsagePercentage = (current: number, limit: number) => {
    if (limit === -1) return 0; // Unlimited
    return Math.min((current / limit) * 100, 100);
  };

  const getUsageStatus = (current: number, limit: number) => {
    if (limit === -1) return 'unlimited';
    const percentage = getUsagePercentage(current, limit);
    if (percentage >= 90) return 'critical';
    if (percentage >= 75) return 'warning';
    return 'normal';
  };

  const usageItems = [
    {
      label: 'Transactions',
      current: usage.transactions_count,
      limit: currentLimits.monthly_transactions,
      icon: TrendingUp,
    },
    {
      label: 'Transaction Amount',
      current: usage.transactions_amount,
      limit: currentLimits.monthly_transaction_amount,
      icon: TrendingUp,
      format: (value: number) => `K${value.toLocaleString()}`,
    },
    {
      label: 'Virtual Cards',
      current: usage.cards_created,
      limit: currentLimits.virtual_cards_limit,
      icon: CheckCircle,
    },
    {
      label: 'API Calls',
      current: usage.api_calls,
      limit: currentLimits.api_calls_per_hour,
      icon: TrendingUp,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Monthly Usage - {usage.month_year}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {usageItems.map((item) => {
          const status = getUsageStatus(item.current, item.limit);
          const percentage = getUsagePercentage(item.current, item.limit);
          const Icon = item.icon;
          
          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {status === 'unlimited' ? (
                    <Badge variant="secondary">Unlimited</Badge>
                  ) : (
                    <>
                      {status === 'critical' && (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      {status === 'warning' && (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                      <Badge 
                        variant={
                          status === 'critical' ? 'destructive' : 
                          status === 'warning' ? 'secondary' : 'outline'
                        }
                      >
                        {item.format ? item.format(item.current) : item.current} / {item.format ? item.format(item.limit) : item.limit}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
              
              {status !== 'unlimited' && (
                <Progress 
                  value={percentage} 
                  className={`h-2 ${
                    status === 'critical' ? 'bg-red-100' : 
                    status === 'warning' ? 'bg-yellow-100' : 'bg-green-100'
                  }`}
                />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default UsageTracker;
