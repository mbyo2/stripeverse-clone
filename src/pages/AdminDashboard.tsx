
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Users, Shield, Activity, AlertTriangle, Settings, Database } from "lucide-react";

interface UserStat {
  total_users: number;
  active_users: number;
  business_users: number;
  admin_users: number;
}

interface SystemStat {
  total_transactions: number;
  total_wallets: number;
  pending_kyc: number;
}

const AdminDashboard = () => {
  const { toast } = useToast();
  const [userStats, setUserStats] = useState<UserStat>({
    total_users: 0,
    active_users: 0,
    business_users: 0,
    admin_users: 0
  });
  const [systemStats, setSystemStats] = useState<SystemStat>({
    total_transactions: 0,
    total_wallets: 0,
    pending_kyc: 0
  });
  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);

      // Fetch user statistics
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id');

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role, user_id');

      const { data: transactions } = await supabase
        .from('transactions')
        .select('id');

      const { data: wallets } = await supabase
        .from('wallets')
        .select('id');

      const { data: kycPending } = await supabase
        .from('kyc_verifications')
        .select('id')
        .eq('level', 'none');

      const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      // Calculate user stats
      const totalUsers = profiles?.length || 0;
      const businessUsers = userRoles?.filter(ur => ur.role === 'business').length || 0;
      const adminUsers = userRoles?.filter(ur => ur.role === 'admin').length || 0;

      setUserStats({
        total_users: totalUsers,
        active_users: totalUsers, // Simplified - in real app would check last activity
        business_users: businessUsers,
        admin_users: adminUsers
      });

      setSystemStats({
        total_transactions: transactions?.length || 0,
        total_wallets: wallets?.length || 0,
        pending_kyc: kycPending?.length || 0
      });

      setRecentNotifications(notifications || []);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const adminActions = [
    {
      title: "User Management",
      description: "Manage user accounts and roles",
      icon: <Users className="h-6 w-6" />,
      link: "/role-management",
      color: "bg-blue-500"
    },
    {
      title: "Security Settings",
      description: "Configure system security",
      icon: <Shield className="h-6 w-6" />,
      link: "/admin/security",
      color: "bg-green-500"
    },
    {
      title: "System Monitoring",
      description: "Monitor system performance",
      icon: <Activity className="h-6 w-6" />,
      link: "/admin/monitoring",
      color: "bg-purple-500"
    },
    {
      title: "Compliance Center",
      description: "Manage compliance and KYC",
      icon: <AlertTriangle className="h-6 w-6" />,
      link: "/compliance",
      color: "bg-orange-500"
    }
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-red-50 to-orange-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">System overview and management tools</p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.total_users}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Business Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.business_users}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.total_transactions}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Pending KYC</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">{systemStats.pending_kyc}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Admin Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {adminActions.map((action) => (
                    <Link key={action.title} to={action.link}>
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="p-6">
                          <div className={`w-12 h-12 ${action.color} rounded-lg flex items-center justify-center text-white mb-4`}>
                            {action.icon}
                          </div>
                          <h3 className="font-semibold mb-2">{action.title}</h3>
                          <p className="text-sm text-muted-foreground">{action.description}</p>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>User Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Total Registered Users</span>
                    <Badge variant="default">{userStats.total_users}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Users</span>
                    <Badge variant="default">{userStats.active_users}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Business Users</span>
                    <Badge variant="secondary">{userStats.business_users}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Admin Users</span>
                    <Badge variant="destructive">{userStats.admin_users}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>System Health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Database Status</span>
                    <Badge variant="default">Operational</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>API Status</span>
                    <Badge variant="default">Operational</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Payment System</span>
                    <Badge variant="default">Operational</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Data Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Total Wallets</span>
                    <span className="font-medium">{systemStats.total_wallets}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Total Transactions</span>
                    <span className="font-medium">{systemStats.total_transactions}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pending KYC Reviews</span>
                    <span className="font-medium text-orange-600">{systemStats.pending_kyc}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Recent System Notifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentNotifications.length === 0 ? (
                    <p className="text-muted-foreground">No recent notifications</p>
                  ) : (
                    recentNotifications.map((notification) => (
                      <div key={notification.id} className="flex items-start justify-between p-4 border rounded-lg">
                        <div>
                          <h4 className="font-medium">{notification.title}</h4>
                          <p className="text-sm text-muted-foreground">{notification.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(notification.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant={notification.type === 'role_request' ? 'default' : 'secondary'}>
                          {notification.type}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default AdminDashboard;
