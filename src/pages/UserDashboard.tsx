
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { FeatureList, RoleBadge } from "@/components/FeatureAccess";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { Link } from "react-router-dom";
import { Wallet, CreditCard, Send, Users, Settings, HelpCircle } from "lucide-react";

const UserDashboard = () => {
  const { user } = useAuth();
  const { hasAccess } = useRoles();

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
      available: hasAccess("virtual_cards")
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Welcome back!</h1>
            <p className="text-muted-foreground">Manage your account and payments</p>
          </div>
          <RoleBadge />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {quickActions.map((action) => (
                    <div key={action.title} className="relative">
                      <Link to={action.link}>
                        <Button
                          variant="outline"
                          className={`w-full h-20 flex flex-col gap-2 ${
                            !action.available ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          disabled={!action.available}
                        >
                          {action.icon}
                          <span className="text-sm font-medium">{action.title}</span>
                        </Button>
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
                <CardTitle>Account Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Email</span>
                  <span className="text-sm text-muted-foreground">{user?.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Account Status</span>
                  <Badge variant="default">Active</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Member Since</span>
                  <span className="text-sm text-muted-foreground">
                    {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Available Features</CardTitle>
              </CardHeader>
              <CardContent>
                <FeatureList />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Links</CardTitle>
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
