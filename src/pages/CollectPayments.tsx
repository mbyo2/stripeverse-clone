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
                  <CardDescription>Mastercard accepted</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Accept debit and credit card payments online. Supports 3D Secure authentication.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">PCI Compliant</Badge>
                <Badge variant="outline">3D Secure</Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Transaction fee</span><span className="font-medium">2.9% + K2.50</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Settlement</span><span className="font-medium">T+1</span></div>
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
              <p className="text-sm text-muted-foreground mb-4">Collect payments via mobile money. USSD push for instant collection from any phone.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">MTN MoMo</Badge>
                <Badge variant="outline">Airtel Money</Badge>
                <Badge variant="outline">Zamtel Kwacha</Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Transaction fee</span><span className="font-medium">1.5%</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Settlement</span><span className="font-medium">Instant</span></div>
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
              <p className="text-sm text-muted-foreground mb-4">Share payment links via email, SMS, or social media. Customers pay through a hosted checkout.</p>
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
              <p className="text-sm text-muted-foreground mb-4">Generate virtual bank account numbers for each customer. Auto-reconcile incoming payments.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Auto-reconcile</Badge>
                <Badge variant="outline">Dedicated VAN</Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Transaction fee</span><span className="font-medium">K10 flat</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Settlement</span><span className="font-medium">Same day</span></div>
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
              <p className="text-sm text-muted-foreground mb-4">Generate dynamic QR codes for in-person and online payments. Works with any mobile wallet.</p>
              <div className="flex gap-2 mb-4">
                <Badge variant="outline">Dynamic QR</Badge>
                <Badge variant="outline">In-store</Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Transaction fee</span><span className="font-medium">0.5%</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Settlement</span><span className="font-medium">Instant</span></div>
              </div>
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
                <p className="font-semibold text-sm">PCI DSS Level 1</p>
                <p className="text-xs text-muted-foreground">Card data security</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <Zap className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">99.99% Uptime</p>
                <p className="text-xs text-muted-foreground">High availability</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <Globe className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="font-semibold text-sm">180+ Countries</p>
                <p className="text-xs text-muted-foreground">Global coverage</p>
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
