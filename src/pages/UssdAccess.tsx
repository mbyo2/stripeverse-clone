
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CopyIcon, Hash, Phone, CheckCircle2, MessageSquare } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const UssdAccess = () => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { toast } = useToast();

  const ussdCodes = {
    register: "*218*1#",
    sendMoney: "*218*2*phoneNumber*amount#",
    checkBalance: "*218*3#",
    buyAirtime: "*218*4*phoneNumber*amount#",
    payBill: "*218*5*accountNumber*amount#"
  };

  const ussdInstructions = {
    mtn: [
      "Dial *218# on your MTN phone",
      "Select option 1 to register",
      "Enter your PIN to authenticate",
      "Select desired service from the menu"
    ],
    airtel: [
      "Dial *218# on your Airtel phone",
      "Select option 1 to register",
      "Enter your PIN to authenticate",
      "Select desired service from the menu"
    ],
    zamtel: [
      "Dial *218# on your Zamtel phone",
      "Select option 1 to register",
      "Enter your PIN to authenticate",
      "Select desired service from the menu"
    ]
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    
    toast({
      title: "USSD code copied",
      description: "Code copied to clipboard",
    });
    
    setTimeout(() => setCopiedCode(null), 3000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8 text-center">
            <h1 className="text-3xl sm:text-4xl font-bold mb-3">BMaGlass Pay USSD Access</h1>
            <p className="text-muted-foreground text-lg">
              Access BMaGlass Pay services from any phone - no internet or smartphone required
            </p>
          </div>
          
          <div className="grid gap-8 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Hash className="h-5 w-5" />
                  USSD Quick Codes
                </CardTitle>
                <CardDescription>Common USSD codes for BMaGlass Pay services</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(ussdCodes).map(([service, code]) => (
                  <div key={service} className="flex justify-between items-center p-3 bg-secondary/20 rounded-lg">
                    <div>
                      <p className="font-medium capitalize">{service.replace(/([A-Z])/g, ' $1')}</p>
                      <p className="text-sm font-mono text-muted-foreground">{code}</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleCopyCode(code)}
                      className="flex items-center gap-2"
                    >
                      {copiedCode === code ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <CopyIcon className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  How to Access
                </CardTitle>
                <CardDescription>Step-by-step instructions for each network</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="mtn">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="mtn">MTN</TabsTrigger>
                    <TabsTrigger value="airtel">Airtel</TabsTrigger>
                    <TabsTrigger value="zamtel">Zamtel</TabsTrigger>
                  </TabsList>
                  
                  {Object.entries(ussdInstructions).map(([provider, steps]) => (
                    <TabsContent key={provider} value={provider} className="pt-4">
                      <ol className="space-y-3">
                        {steps.map((step, index) => (
                          <li key={index} className="flex gap-3">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                              {index + 1}
                            </div>
                            <p>{step}</p>
                          </li>
                        ))}
                      </ol>
                      
                      <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                        <div className="flex gap-2 items-start">
                          <MessageSquare className="h-5 w-5 text-yellow-600 mt-0.5" />
                          <div>
                            <p className="font-medium text-yellow-800">Tip</p>
                            <p className="text-sm text-yellow-700">
                              Save *218# as a contact in your phone for quick access to BMaGlass Pay services.
                            </p>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>
          
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>USSD Menu Structure</CardTitle>
              <CardDescription>Navigation guide for the BMaGlass Pay USSD menu system</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="border rounded-md p-4">
                  <h3 className="font-bold text-center mb-2">Main Menu (*218#)</h3>
                  <ul className="space-y-2">
                    <li>1. Send Money</li>
                    <li>2. Buy Airtime/Bundles</li>
                    <li>3. Pay Bills</li>
                    <li>4. Check Balance</li>
                    <li>5. My Account</li>
                  </ul>
                </div>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="border rounded-md p-4">
                    <h3 className="font-bold mb-2">Send Money (Option 1)</h3>
                    <ul className="space-y-2">
                      <li>1. To BMaGlass Pay User</li>
                      <li>2. To Mobile Money</li>
                      <li>3. To Bank Account</li>
                      <li>4. International Transfer</li>
                    </ul>
                  </div>
                  
                  <div className="border rounded-md p-4">
                    <h3 className="font-bold mb-2">My Account (Option 5)</h3>
                    <ul className="space-y-2">
                      <li>1. Check Balance</li>
                      <li>2. Mini Statement</li>
                      <li>3. Change PIN</li>
                      <li>4. Set Default Account</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div className="mt-8 text-center">
                <p className="text-muted-foreground mb-4">Need help with USSD services?</p>
                <Button className="mx-auto">
                  <Phone className="mr-2 h-4 w-4" />
                  Contact Support
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default UssdAccess;
