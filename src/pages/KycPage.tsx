
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import KycVerification from "@/components/wallet/KycVerification";
import { ShieldCheck, ShieldAlert } from "lucide-react";

const KycPage = () => {
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Identity Verification</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <KycVerification />
          </div>
          
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <ShieldCheck className="mr-2 h-5 w-5 text-primary" />
                  Why Verify?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="bg-primary/10 text-primary rounded-full p-1 mr-2 mt-0.5">✓</span>
                    <span>Increase your transaction limits</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary/10 text-primary rounded-full p-1 mr-2 mt-0.5">✓</span>
                    <span>Access advanced payment features</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary/10 text-primary rounded-full p-1 mr-2 mt-0.5">✓</span>
                    <span>Improved account security</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary/10 text-primary rounded-full p-1 mr-2 mt-0.5">✓</span>
                    <span>Faster transaction processing</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary/10 text-primary rounded-full p-1 mr-2 mt-0.5">✓</span>
                    <span>Required for international transfers</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <ShieldAlert className="mr-2 h-5 w-5 text-amber-500" />
                  Verification Levels
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium mb-1">Level 1: Basic</h3>
                  <p className="text-sm text-muted-foreground">
                    Requires ID verification. Daily limit: K5,000
                  </p>
                </div>
                
                <div>
                  <h3 className="font-medium mb-1">Level 2: Full</h3>
                  <p className="text-sm text-muted-foreground">
                    Requires address and photo verification. Daily limit: K25,000
                  </p>
                </div>
                
                <div className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                  <p>Verification is conducted in compliance with Bank of Zambia regulations.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default KycPage;
