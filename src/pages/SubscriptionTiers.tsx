import React from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Receipt } from "lucide-react";

// This page used to present subscription tiers. Subscriptions were
// removed entirely (CEO decision 2026-10-26 18:31): there are no
// plans, no tiers to compare and nothing to upgrade. The route stays
// so old links land on the truth instead of an error — the only
// charges on BMaGlass Pay are the percentage transaction fees,
// listed in full on the Pricing page.
const SubscriptionTiers = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Receipt className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">There Are No Subscription Plans</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Every BMaGlass Pay account is the same account, with the full product. You only pay
              a small percentage fee when you send, transfer, trade or get paid — shown to you
              before you confirm, every time.
            </p>
            <Button asChild>
              <Link to="/pricing">
                See the fees
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

export default SubscriptionTiers;
