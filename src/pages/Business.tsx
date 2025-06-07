
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
import { Store, CreditCard, BarChart3, Settings, Users, Shield } from "lucide-react";

const Business = () => {
  const { user } = useAuth();
  const { hasAccess } = useRoles();

  const businessTools = [
    {
      title: "Payment Processing",
      description: "Accept payments from customers",
      icon: <CreditCard className="h-6 w-6" />,
      link: "/business/payments",
      available: true
    },
    {
      title: "Analytics",
      description: "View business performance metrics",
      icon: <BarChart3 className="h-6 w-6" />,
      link: "/business/analytics",
      available: true
    },
    {
      title: "Customer Management",
      description: "Manage your customer database",
      icon: <Users className="h-6 w-6" />,
      link: "/business/customers",
      available: true
    },
    {
      title: "Security Settings",
      description: "Configure security and compliance",
      icon: <Shield className="h-6 w-6" />,
      link: "/business/security",
      available: true
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-green-50 to-blue-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Business Dashboard</h1>
            <p className="text-muted-foreground">Manage your business operations and payments</p>
          </div>
          <RoleBadge />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  Business Tools
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {businessTools.map((tool) => (
                    <div key={tool.title} className="relative">
                      <Button
                        variant="outline"
                        className={`w-full h-20 flex flex-col gap-2 ${
                          !tool.available ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        disabled={!tool.available}
                        onClick={() => {
                          // For now, just show a message since these pages don't exist yet
                          console.log(`Navigate to ${tool.link}`);
                        }}
                      >
                        {tool.icon}
                        <span className="text-sm font-medium">{tool.title}</span>
                      </Button>
                      {!tool.available && (
                        <Badge variant="secondary" className="absolute -top-2 -right-2 text-xs">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Business Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">K 12,450</div>
                    <div className="text-sm text-muted-foreground">Monthly Revenue</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">156</div>
                    <div className="text-sm text-muted-foreground">Transactions</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">23</div>
                    <div className="text-sm text-muted-foreground">Active Customers</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Business Features</CardTitle>
              </CardHeader>
              <CardContent>
                <FeatureList />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link to="/settings">
                  <Button variant="ghost" className="w-full justify-start">
                    <Settings className="h-4 w-4 mr-2" />
                    Business Settings
                  </Button>
                </Link>
                <Link to="/compliance">
                  <Button variant="ghost" className="w-full justify-start">
                    <Shield className="h-4 w-4 mr-2" />
                    Compliance
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

export default Business;
