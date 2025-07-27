
import React, { useState, useEffect } from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import RoleRequestForm from "@/components/RoleRequestForm";
import SecurityDashboard from "@/components/SecurityDashboard";
import type { Tables } from "@/integrations/supabase/types";

type RoleRequest = Tables<'role_requests'>;

const RoleManagement = () => {
  const { user } = useAuth();
  const { roles, hasRole, refreshRoles } = useRoles();
  const { toast } = useToast();
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const availableRoles = [
    { id: 'business', name: 'Business', description: 'Access to business features' },
    { id: 'beta_tester', name: 'Beta Tester', description: 'Early access to new features' }
  ];

  useEffect(() => {
    fetchRoleRequests();
  }, []);

  const fetchRoleRequests = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('role_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      // Error handled by toast in component
    } finally {
      setIsLoading(false);
    }
  };

  const requestRole = async (roleId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('role_requests')
        .insert({
          user_id: user.id,
          requested_role: roleId as any,
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Role request submitted",
        description: "Your request has been submitted for admin review.",
      });

      fetchRoleRequests();
    } catch (error: any) {
      toast({
        title: "Request failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Role Management</h1>
          <p className="text-muted-foreground">
            Manage your account roles and permissions
          </p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="request">Request Role</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card>
                <CardHeader>
                  <CardTitle>Current Roles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {roles.map((role) => (
                      <Badge key={role} variant="default" className="mr-2">
                        {role}
                      </Badge>
                    ))}
                    {roles.length === 0 && (
                      <p className="text-muted-foreground">No roles assigned</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Available Roles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {availableRoles.map((role) => (
                      <div key={role.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{role.name}</h3>
                          <p className="text-sm text-muted-foreground">{role.description}</p>
                        </div>
                        <Badge variant={hasRole(role.id as any) ? "default" : "secondary"}>
                          {hasRole(role.id as any) ? 'Assigned' : 'Available'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {requests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>My Role Requests</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {requests.map((request) => (
                      <div key={request.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium capitalize">{request.requested_role} Role</h3>
                          <p className="text-sm text-muted-foreground">
                            Requested on {new Date(request.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge 
                          variant={
                            request.status === 'approved' ? 'default' : 
                            request.status === 'rejected' ? 'destructive' : 
                            'secondary'
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="request">
            <RoleRequestForm />
          </TabsContent>

          <TabsContent value="security">
            <SecurityDashboard />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default RoleManagement;
