
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { FeatureList, RoleBadge } from "@/components/FeatureAccess";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { useFeatureVisibility } from "@/hooks/useFeatureVisibility";
import { Link } from "react-router-dom";
import { Wallet, CreditCard, Send, Users, Settings, HelpCircle } from "lucide-react";

const UserDashboard = () => {
  const { user } = useAuth();
  const { hasAccess } = useRoles();
  const { canSee: canSeeFeature } = useFeatureVisibility();

  const quickActions = [
    {
      title: "Wallet",
      description: "View balance and transactions",
      icon: <Wallet className="h-6 w-6" />,
      link: "/wallet",
      available: true
    },
    {
      title: "Virtual Cards",
      description: "Manage your virtual cards",
      icon: <CreditCard className="h-6 w-6" />,
      link: "/card/new",
      // Follows the feature registry (CEO directive 2026-10-30):
      // virtual cards are not available to regular users.
      available: canSeeFeature("virtualCards")
    },
    {
      title: "Send Money",
      description: "Transfer money to others",
      icon: <Send className="h-6 w-6" />,
      link: "/transfer",
      available: hasAccess("transfers")
    },
    {
      title: "Role Management",
      description: "Manage your account roles",
      icon: <Users className="h-6 w-6" />,
      link: "/role-management",
      available: true
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">Welcome back!</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your account and payments</p>
          </div>
          <RoleBadge />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap justify-between gap-y-6">
                  {quickActions.filter((action) => action.title !== "Virtual Cards" || canSeeFeature("virtualCards")).map((action) => (
                    <div key={action.title} className="relative w-24">
                      <Link to={action.link} className={!action.available ? 'pointer-events-none' : ''}>
                        <div className={`flex flex-col items-center gap-2 text-center ${!action.available ? 'opacity-50' : ''}`}>
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            {action.icon}
                          </div>
                          <span className="text-sm font-medium">{action.title}</span>
                        </div>
                      </Link>
                      {!action.available && (
                        <Badge variant="secondary" className="absolute -top-2 -right-2 text-xs">
                          Upgrade
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Account Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium">Email</span>
                    <span className="text-sm text-muted-foreground">{user?.email}</span>
                  </div>
                  <div className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium">Account Status</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium">Member Since</span>
                    <span className="text-sm text-muted-foreground">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Available Features</CardTitle>
              </CardHeader>
              <CardContent>
                <FeatureList />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link to="/settings">
                  <Button variant="ghost" className="w-full justify-start">
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Button>
                </Link>
                <Link to="/help">
                  <Button variant="ghost" className="w-full justify-start">
                    <HelpCircle className="h-4 w-4 mr-2" />
                    Help & Support
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default UserDashboard;
