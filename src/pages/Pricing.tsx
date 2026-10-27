import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftRight, Bitcoin, CreditCard, Link2, MessagesSquare, Send, Wallet } from "lucide-react";

// Pricing is a fee schedule, not a plan catalogue: subscriptions
// were removed entirely (CEO decision 2026-10-26 18:31 — "just
// leave the percentage payments we had"). Every figure below is the
// fee the platform actually charges, read from the live code and
// settings on 2026-10-26 (PayPal line added 2026-10-28):
//   - Send money 2.5%        platform_settings.send_money_fee_percent
//   - Transfer 1.5%          platform_settings.transfer_fee_percent
//   - P2P trades 0.5%        platform_settings.p2p_fee_percent
//   - Instant buy/sell 1.5%  btc-trade fee (150 bps default)
//   - Payment links 2.5%     platform_settings.split_platform_fee_percent
//   - PayPal payments 1%     platform_settings.paypal_platform_fee_percent
//   - Card funding 1% min K2 fund-virtual-card fee code
// If a fee changes in settings/code, this page must change with it —
// the removal test pins these numbers to their sources.
const FEES = [
  {
    icon: <Send className="h-5 w-5" />,
    name: "Send Money",
    fee: "2.5%",
    detail: "Of the amount you send. The fee is shown before you confirm — no surprises afterwards.",
  },
  {
    icon: <ArrowLeftRight className="h-5 w-5" />,
    name: "Transfer Between Accounts",
    fee: "1.5%",
    detail: "Moving money to another BMaGlass Pay account costs 1.5% of the amount transferred.",
  },
  {
    icon: <MessagesSquare className="h-5 w-5" />,
    name: "P2P Trades",
    fee: "0.5%",
    detail: "Buying or selling with another person through P2P escrow costs 0.5% of the trade.",
  },
  {
    icon: <Bitcoin className="h-5 w-5" />,
    name: "Buy or Sell Bitcoin Instantly",
    fee: "1.5%",
    detail: "Instant Bitcoin buys and sells cost 1.5% of the amount, on top of the quoted exchange rate.",
  },
  {
    icon: <Link2 className="h-5 w-5" />,
    name: "Payment Links",
    fee: "2.5%",
    detail: "Charged when a payment link is paid from a BMaGlass wallet or with Bitcoin. The seller chooses who pays it — themselves, or the buyer on top of the price. A link paid through PayPal carries the 1% PayPal fee instead.",
  },
  {
    icon: <Wallet className="h-5 w-5" />,
    name: "Accept PayPal Payments",
    fee: "1%",
    detail: "Receiving a PayPal payment through BMaGlass Pay — checkout, a payment link, or any plug-in or SDK — costs 1% of the amount. PayPal's own processing fee also applies and is charged by PayPal, not by us.",
  },
  {
    icon: <CreditCard className="h-5 w-5" />,
    name: "Fund a Virtual Card",
    fee: "1%",
    detail: "Funding a virtual card costs 1% of the amount, with a minimum fee of K2.",
  },
];

const Pricing = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-2">Pay Only When You Move Money</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            BMaGlass Pay has no subscription plans and no monthly fees. Every charge is a
            percentage of a transaction you actually make — if you don't transact, you pay nothing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEES.map((item) => (
            <Card key={item.name} className="flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg">
              <CardHeader>
                <div className="flex items-center space-x-2 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {item.icon}
                  </div>
                  <CardTitle className="text-lg">{item.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="mb-4">
                  <span className="text-3xl font-bold">{item.fee}</span>
                </div>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 bg-secondary/10 rounded-lg p-8 text-center">
          <h2 className="text-xl font-bold mb-2">One account for everyone</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            There are no tiers to unlock and nothing to upgrade. Every BMaGlass Pay account gets
            the full product, and the fees above are the only charges — each one shown to you
            before you confirm a transaction.
          </p>
        </div>

        {/* Why Choose BMaGlass Pay */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">Why Businesses Choose BMaGlass Pay</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Zambian Owned</h4>
              <p className="text-sm text-muted-foreground">Built by Zambians for Zambian businesses, with full understanding of local market needs.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Local Support</h4>
              <p className="text-sm text-muted-foreground">Lusaka-based team providing personalized support in your local language.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Easy Integration</h4>
              <p className="text-sm text-muted-foreground">Developer-friendly APIs and plug-ins for quick implementation into your systems.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Reliable Infrastructure</h4>
              <p className="text-sm text-muted-foreground">Built on robust technology for your business.</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
