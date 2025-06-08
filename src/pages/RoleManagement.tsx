
import React, { useState, useEffect } from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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
      console.error('Error fetching role requests:', error);
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
              <CardTitle>Request Additional Roles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {availableRoles.map((role) => (
                  <div key={role.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h3 className="font-medium">{role.name}</h3>
                      <p className="text-sm text-muted-foreground">{role.description}</p>
                    </div>
                    <Button
                      onClick={() => requestRole(role.id)}
                      disabled={hasRole(role.id as any) || isLoading}
                      size="sm"
                    >
                      {hasRole(role.id as any) ? 'Already Assigned' : 'Request'}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {requests.length > 0 && (
          <Card className="mt-8">
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
      </main>
      <Footer />
    </div>
  );
};

export default RoleManagement;
