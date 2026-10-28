import React from 'react';
import { Link } from 'react-router-dom';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, ArrowRight } from "lucide-react";

// Billing is no longer a subscription page: subscriptions were
// removed entirely (CEO decision 2026-10-26 18:31). There is no
// plan to manage, no monthly bill and nothing to upgrade — this
// page explains the only charges that exist (the percentage
// transaction fees) and points at the full schedule on Pricing.
// The fee figures mirror src/pages/Pricing.tsx, whose header lists
// their live sources.
const FEES: Array<{ name: string; fee: string }> = [
  { name: "Send money", fee: "2.5%" },
  { name: "Transfer between accounts", fee: "1.5%" },
  { name: "P2P trades", fee: "0.5%" },
  { name: "Buy or sell Bitcoin instantly", fee: "1.5%" },
  { name: "Payment links (when paid)", fee: "2.5%" },
  { name: "PayPal payments (when received)", fee: "1%" },
  { name: "Fund a virtual card (limited release)", fee: "1% (minimum K2)" },
];

const Billing = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Billing</h1>
          <p className="text-muted-foreground">
            How you are charged on BMaGlass Pay
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>No plans, no monthly bills</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              BMaGlass Pay has no subscription plans. You are charged only a percentage fee on a
              transaction when you make one, and every fee is shown to you before you confirm.
              If you don't transact, you pay nothing.
            </p>

            <ul className="divide-y">
              {FEES.map((item) => (
                <li key={item.name} className="flex justify-between py-3">
                  <span className="text-sm">{item.name}</span>
                  <span className="text-sm font-medium">{item.fee}</span>
                </li>
              ))}
            </ul>

            <p className="text-sm text-muted-foreground">
              Every fee you have paid is itemised in your transaction history.
            </p>

            <Button asChild>
              <Link to="/pricing">
                See the full fee schedule
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Billing;
