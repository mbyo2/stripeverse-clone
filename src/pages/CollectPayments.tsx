import React, { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreditCard, Smartphone, Globe, QrCode, Link2, ShieldCheck, Zap, BarChart3, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const CollectPayments = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Collect Payments</h1>
          <p className="text-muted-foreground">Accept payments from customers through multiple channels</p>
        </div>

        {/* Payment Methods Overview */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-10">
          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><CreditCard className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">Card Payments</CardTitle>
                  <CardDescription>Not yet available</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Card collection is not enabled yet. Today, payment links accept wallet-to-wallet payments from customers with a BMaGlass account.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Not yet available</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Smartphone className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">Mobile Money</CardTitle>
                  <CardDescription>MTN, Airtel, Zamtel</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Mobile money collection is not connected yet — no mobile-money provider is configured, so these payments can't be taken today.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Not yet available</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Link2 className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">Payment Links</CardTitle>
                  <CardDescription>No code required</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Share payment links via email, SMS, or social media. Customers pay from their BMaGlass wallet through a hosted checkout page, and you choose which of your accounts each link settles into.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Shareable</Badge>
                <Badge variant="outline">Custom Branding</Badge>
              </div>
              <Link to="/payment-links">
                <Button className="w-full"><ArrowRight className="h-4 w-4 mr-2" />Create Payment Link</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Globe className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">Bank Transfer</CardTitle>
                  <CardDescription>Direct deposits</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Bank-transfer collection is not available yet — BMaGlass does not issue virtual account numbers or reconcile bank deposits.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Not yet available</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><QrCode className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">QR Code</CardTitle>
                  <CardDescription>Scan to pay</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Generate a QR code in the app. Customers with a BMaGlass account scan it in the app and pay you from their wallet.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">In-app scan & pay</Badge>
                <Badge variant="outline">In-store</Badge>
              </div>
              <Link to="/qr-payments">
                <Button variant="outline" className="w-full"><ArrowRight className="h-4 w-4 mr-2" />Open QR Payments</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Zap className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle className="text-lg">Checkout API</CardTitle>
                  <CardDescription>Developer integration</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Integrate payments directly into your app with our Checkout SDK. Full control over the payment experience.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">REST API</Badge>
                <Badge variant="outline">Webhooks</Badge>
              </div>
              <Link to="/developers">
                <Button variant="outline" className="w-full"><ArrowRight className="h-4 w-4 mr-2" />View API Docs</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Integration Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Security & Compliance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">Two-Factor Authentication</p>
                <p className="text-xs text-muted-foreground">TOTP protection for accounts</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <Zap className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">Fraud Rules</p>
                <p className="text-xs text-muted-foreground">Configurable rules on your account</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <Globe className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">Built for Zambia</p>
                <p className="text-xs text-muted-foreground">Kwacha-first payments</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">Real-time Analytics</p>
                <p className="text-xs text-muted-foreground">Monitor everything</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default CollectPayments;
