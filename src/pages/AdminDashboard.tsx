
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminCryptoPayouts } from "@/components/web3/AdminCryptoPayouts";
import { AdminTreasuryConfig } from "@/components/web3/AdminTreasuryConfig";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/contexts/RoleContext";
import { adminDashboardVisibility } from "@/lib/roleVisibility";
import { supabase } from "@/integrations/supabase/client";
import { countActiveUsers, activityWindowStart } from "@/utils/adminStats";
import { Link } from "react-router-dom";
import { Users, Shield, Activity, AlertTriangle, Settings, Database, ScanFace, Globe2, Inbox, ReceiptText, CreditCard, Landmark } from "lucide-react";

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

interface AdminAction {
  title: string;
  description: string;
  icon: React.ReactNode;
  link: string;
  color: string;
  /** super_admin-only destination: the card is not rendered at
   *  all for any other viewer (least privilege — see
   *  adminDashboardVisibility in src/lib/roleVisibility.ts). */
  superAdminOnly?: boolean;
}

const AdminDashboard = () => {
  const { toast } = useToast();
  const { roles } = useRoles();
  const dashboardVisibility = adminDashboardVisibility(roles);
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
  const [health, setHealth] = useState<{ status: 'checking' | 'operational' | 'unreachable'; latencyMs?: number; checkedAt?: Date }>({ status: 'checking' });

  // Real, client-side health probe: time a trivial read through the same
  // PostgREST/database path the admin data above uses. Nothing else on
  // this page is probed, so nothing else is labelled "Operational".
  const runHealthCheck = async () => {
    setHealth({ status: 'checking' });
    const startedAt = performance.now();
    const { error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (error) {
      setHealth({ status: 'unreachable', checkedAt: new Date() });
    } else {
      setHealth({ status: 'operational', latencyMs: Math.round(performance.now() - startedAt), checkedAt: new Date() });
    }
  };

  useEffect(() => {
    fetchDashboardData();
    runHealthCheck();
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

      // Active users, honestly defined: distinct users with at least
      // one transaction in the trailing 30 days (see utils/adminStats —
      // the label on the tile says exactly this). Paginated so the
      // count stays exact past PostgREST's 1000-row default page. This
      // replaces the old `active_users: totalUsers` simplification,
      // which presented every registered user as active.
      const now = new Date();
      const windowStart = activityWindowStart(now).toISOString();
      const activityRows: { user_id: string | null; created_at: string }[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page } = await supabase
          .from('transactions')
          .select('user_id, created_at')
          .gte('created_at', windowStart)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!page?.length) break;
        activityRows.push(...page);
        if (page.length < PAGE) break;
      }
      const activeUsers = countActiveUsers(activityRows, now);

      setUserStats({
        total_users: totalUsers,
        active_users: activeUsers,
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

  const adminActions: AdminAction[] = [
    {
      title: "User Management",
      description: "Manage users, roles, and KYC approvals",
      icon: <Users className="h-6 w-6" />,
      link: "/admin/users",
      color: "bg-blue-500"
    },
    {
      title: "Transaction Oversight",
      description: "Monitor all platform transactions",
      icon: <Activity className="h-6 w-6" />,
      link: "/admin/transactions",
      color: "bg-green-500"
    },
    {
      title: "Treasury & Reports",
      description: "Platform balances, fee income and reports (super admin)",
      icon: <Landmark className="h-6 w-6" />,
      link: "/admin/treasury",
      color: "bg-amber-500",
      superAdminOnly: true
    },
    {
      title: "P2P Disputes",
      description: "Rule P2P disputes and manage sanctions",
      icon: <AlertTriangle className="h-6 w-6" />,
      link: "/admin/p2p",
      color: "bg-orange-500"
    },
    {
      title: "Identity Review",
      description: "Decide face verifications waiting on a human",
      icon: <ScanFace className="h-6 w-6" />,
      link: "/admin/identity",
      color: "bg-purple-500"
    },
    {
      title: "Role Management",
      description: "View your roles and request changes",
      icon: <Shield className="h-6 w-6" />,
      link: "/role-management",
      color: "bg-[#003087]"
    },
    {
      title: "Role Requests",
      description: "Approve or reject user role requests",
      icon: <Inbox className="h-6 w-6" />,
      link: "/admin/role-requests",
      color: "bg-indigo-500"
    },
    {
      title: "Refunds Console",
      description: "Track every refund request platform-wide",
      icon: <ReceiptText className="h-6 w-6" />,
      link: "/admin/refunds",
      color: "bg-rose-500"
    },
    {
      title: "Cross-Border Payouts",
      description: "Mastercard Move payouts (sandbox)",
      icon: <Globe2 className="h-6 w-6" />,
      link: "/admin/mastercard-move",
      color: "bg-purple-500"
    },
    {
      title: "MoonPay",
      description: "Card purchases of Bitcoin — status and purchases",
      icon: <CreditCard className="h-6 w-6" />,
      link: "/admin/moonpay",
      color: "bg-violet-500"
    },
    {
      title: "PayPal Withdrawals",
      description: "PayPal payouts, the platform float and its allowance",
      icon: <Landmark className="h-6 w-6" />,
      link: "/admin/paypal",
      color: "bg-sky-600"
    },
    {
      title: "Compliance Center",
      description: "Manage compliance and KYC",
      icon: <AlertTriangle className="h-6 w-6" />,
      link: "/compliance",
      color: "bg-orange-500"
    }
  ];

  // Least privilege (CEO order 2026-10-27): a card whose target
  // route the viewer cannot open is not rendered for them at all.
  // Treasury & Reports is narrower than the dashboard's own
  // admin-tier audience — its route gate and its RPCs are
  // super_admin-only — and the Treasury TAB below is gated by the
  // same model (its table's RLS is super_admin since migration
  // 20261240), so both are driven by the one model in
  // roleVisibility.ts. Roles still loading resolves to no roles,
  // which fails closed: each appears only once super_admin is
  // actually held.
  const visibleAdminActions = adminActions.filter(
    (action) => !action.superAdminOnly || dashboardVisibility.treasuryConsole
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">System overview and management tools</p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          {/* The Treasury tab is super_admin-only (CEO decision
              2026-10-27): its data gate (crypto_treasury_config RLS,
              migration 20261240) is super_admin, so the tab is not
              rendered at all for anyone else — same fail-closed
              model as the Treasury & Reports card above (roles
              loading → no roles → no tab). */}
          <TabsList
            className={`grid w-full grid-cols-3 ${dashboardVisibility.treasuryTab ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}
          >
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="crypto">Crypto Payouts</TabsTrigger>
            {dashboardVisibility.treasuryTab && (
              <TabsTrigger value="treasury">Treasury</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[28px] font-display font-semibold tabular-nums">{userStats.total_users}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Business Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[28px] font-display font-semibold tabular-nums">{userStats.business_users}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[28px] font-display font-semibold tabular-nums">{systemStats.total_transactions}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Pending KYC</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[28px] font-display font-semibold tabular-nums text-orange-600">{systemStats.pending_kyc}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Admin Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {visibleAdminActions.map((action) => (
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
                    <span>Active Users (last 30 days)</span>
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
                    <span>Database & API</span>
                    {health.status === 'checking' ? (
                      <Badge variant="secondary">Checking…</Badge>
                    ) : health.status === 'operational' ? (
                      <Badge variant="default">Operational · {health.latencyMs} ms</Badge>
                    ) : (
                      <Badge variant="destructive">Unreachable</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Payment System</span>
                    <Badge variant="secondary">Not monitored</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The Database & API result is a live check from this browser (a timed read query)
                    {health.checkedAt ? `, last checked ${health.checkedAt.toLocaleTimeString()}` : ''}.
                    No automated probe of the payment rails is configured, so that row is not labelled operational.
                  </p>
                  <Button variant="outline" size="sm" onClick={runHealthCheck} disabled={health.status === 'checking'}>
                    Recheck
                  </Button>
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

          <TabsContent value="crypto">
            <AdminCryptoPayouts />
          </TabsContent>

          {dashboardVisibility.treasuryTab && (
            <TabsContent value="treasury">
              <AdminTreasuryConfig />
            </TabsContent>
          )}
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default AdminDashboard;
