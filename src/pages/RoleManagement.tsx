import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Users, Shield, Crown, TestTube } from "lucide-react";

type UserRole = 'user' | 'business' | 'admin' | 'beta_tester';

const RoleManagement = () => {
  const { user } = useAuth();
  const { roles, hasRole, refreshRoles } = useRoles();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('user');
  const [targetEmail, setTargetEmail] = useState('');

  const roleIcons = {
    user: <Users className="h-5 w-5" />,
    business: <Shield className="h-5 w-5" />,
    admin: <Crown className="h-5 w-5" />,
    beta_tester: <TestTube className="h-5 w-5" />
  };

  const roleDescriptions = {
    user: "Standard user with basic access to wallet and payment features",
    business: "Business user with access to merchant tools and APIs",
    admin: "Administrator with full system access and user management",
    beta_tester: "Beta tester with early access to new features and feedback tools"
  };

  const assignRole = async () => {
    if (!targetEmail || !selectedRole) {
      toast({
        title: "Invalid Input",
        description: "Please provide both email and role",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      // First get the user by email
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', targetEmail)
        .single();

      if (userError) {
        throw new Error('User not found');
      }

      // Assign the role
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userData.id,
          role: selectedRole
        }, {
          onConflict: 'user_id,role'
        });

      if (roleError) throw roleError;

      toast({
        title: "Role Assigned",
        description: `Successfully assigned ${selectedRole} role to ${targetEmail}`,
      });

      setTargetEmail('');
    } catch (error) {
      console.error('Error assigning role:', error);
      toast({
        title: "Assignment Failed",
        description: error instanceof Error ? error.message : "Failed to assign role",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const requestRoleUpgrade = async (requestedRole: UserRole) => {
    setIsLoading(true);
    try {
      // Create a notification for admins
      const { error } = await supabase
        .from('notifications')
        .insert({
          title: 'Role Upgrade Request',
          message: `User ${user?.email} has requested ${requestedRole} role access`,
          type: 'role_request',
          user_id: user!.id
        });

      if (error) throw error;

      toast({
        title: "Request Submitted",
        description: `Your request for ${requestedRole} role has been submitted for review`,
      });
    } catch (error) {
      console.error('Error requesting role:', error);
      toast({
        title: "Request Failed",
        description: "Failed to submit role request",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Role Management</h1>
          <p className="text-muted-foreground">Manage user roles and permissions</p>
        </div>

        <Tabs defaultValue="current" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="current">Current Roles</TabsTrigger>
            <TabsTrigger value="request">Request Role</TabsTrigger>
            {hasRole('admin') && <TabsTrigger value="manage">Manage Users</TabsTrigger>}
          </TabsList>

          <TabsContent value="current">
            <Card>
              <CardHeader>
                <CardTitle>Your Current Roles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {roles.map((role) => (
                    <div key={role} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        {roleIcons[role as UserRole]}
                        <div>
                          <h3 className="font-medium capitalize">{role.replace('_', ' ')}</h3>
                          <p className="text-sm text-muted-foreground">
                            {roleDescriptions[role as UserRole]}
                          </p>
                        </div>
                      </div>
                      <Badge variant="default">Active</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="request">
            <Card>
              <CardHeader>
                <CardTitle>Request Role Upgrade</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(['business', 'beta_tester'] as UserRole[]).map((role) => (
                    <div key={role} className="p-4 border rounded-lg">
                      <div className="flex items-center gap-3 mb-3">
                        {roleIcons[role]}
                        <h3 className="font-medium capitalize">{role.replace('_', ' ')}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">
                        {roleDescriptions[role]}
                      </p>
                      <Button 
                        onClick={() => requestRoleUpgrade(role)}
                        disabled={hasRole(role) || isLoading}
                        variant={hasRole(role) ? "secondary" : "default"}
                        className="w-full"
                      >
                        {hasRole(role) ? "Already Assigned" : "Request Access"}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {hasRole('admin') && (
            <TabsContent value="manage">
              <Card>
                <CardHeader>
                  <CardTitle>Assign Roles to Users</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">User Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="user@example.com"
                        value={targetEmail}
                        onChange={(e) => setTargetEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="business">Business</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="beta_tester">Beta Tester</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={assignRole} disabled={isLoading} className="w-full">
                    {isLoading ? "Assigning..." : "Assign Role"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default RoleManagement;
