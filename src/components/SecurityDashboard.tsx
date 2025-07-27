import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Clock, UserCheck } from "lucide-react";
import { useSecurityMonitoring } from "@/hooks/useSecurityMonitoring";
import { useRoleManagement } from "@/hooks/useRoleManagement";
import { formatDistanceToNow } from "date-fns";

const SecurityDashboard = () => {
  const { securityEvents, roleAuditLogs, isLoading } = useSecurityMonitoring();
  const { requestRoleChange } = useRoleManagement();

  const getRiskBadgeColor = (riskScore: number) => {
    if (riskScore >= 8) return "destructive";
    if (riskScore >= 5) return "default";
    return "secondary";
  };

  const getRiskLabel = (riskScore: number) => {
    if (riskScore >= 8) return "High Risk";
    if (riskScore >= 5) return "Medium Risk";
    return "Low Risk";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {securityEvents?.filter(e => e.risk_score < 5).length || 0}
              </div>
              <div className="text-sm text-green-600">Low Risk Events</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">
                {securityEvents?.filter(e => e.risk_score >= 5 && e.risk_score < 8).length || 0}
              </div>
              <div className="text-sm text-yellow-600">Medium Risk Events</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {securityEvents?.filter(e => e.risk_score >= 8).length || 0}
              </div>
              <div className="text-sm text-red-600">High Risk Events</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="events" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="events">Security Events</TabsTrigger>
          <TabsTrigger value="roles">Role Changes</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Recent Security Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!securityEvents || securityEvents.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No security events recorded.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {securityEvents.slice(0, 10).map((event) => (
                    <div key={event.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{event.event_type}</span>
                          <Badge variant={getRiskBadgeColor(event.risk_score || 0)}>
                            {getRiskLabel(event.risk_score || 0)}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {event.ip_address && `IP: ${event.ip_address}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                Role Change History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!roleAuditLogs || roleAuditLogs.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No role changes recorded.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {roleAuditLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {log.old_role} → {log.new_role}
                          </span>
                          <Badge variant={log.approved ? "default" : "destructive"}>
                            {log.approved ? "Approved" : "Rejected"}
                          </Badge>
                        </div>
                        {log.reason && (
                          <div className="text-sm text-muted-foreground mt-1">
                            Reason: {log.reason}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SecurityDashboard;