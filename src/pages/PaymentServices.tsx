
import { useEffect, useRef } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Shield, CreditCard, Smartphone, Phone, Coins, BarChart, Globe, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const PaymentServices = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          contentRef.current?.classList.add("animate-fadeIn");
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    
    return () => {
      if (contentRef.current) {
        observer.unobserve(contentRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div 
            ref={contentRef}
            className="opacity-0"
          >
            <div className="text-center mb-12">
              <h1 className="text-4xl font-bold mb-4">Payment Services</h1>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Zambia's most trusted payment gateway, offering secure and compliant payment solutions for businesses of all sizes.
              </p>
            </div>
            
            {/* Compliance Badges */}
            <div className="flex flex-wrap justify-center gap-6 mb-12">
              <div className="flex items-center bg-primary/10 px-4 py-2 rounded-full">
                <Shield className="h-5 w-5 text-primary mr-2" />
                <span className="font-medium">PCI DSS Compliant</span>
              </div>
              <div className="flex items-center bg-primary/10 px-4 py-2 rounded-full">
                <Shield className="h-5 w-5 text-primary mr-2" />
                <span className="font-medium">Bank of Zambia Approved</span>
              </div>
            </div>
            
            {/* Payment Services Tabs */}
            <Tabs defaultValue="mobile-money" className="mb-16">
              <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full mb-8">
                <TabsTrigger value="mobile-money">Mobile Money</TabsTrigger>
                <TabsTrigger value="card">Card Processing</TabsTrigger>
                <TabsTrigger value="ussd">USSD Payments</TabsTrigger>
                <TabsTrigger value="bitcoin">Bitcoin</TabsTrigger>
                <TabsTrigger value="api">Merchant API</TabsTrigger>
                <TabsTrigger value="settlement">Settlement</TabsTrigger>
              </TabsList>
              
              <TabsContent value="mobile-money">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <Smartphone className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>Mobile Money Integration</CardTitle>
                    </div>
                    <CardDescription>
                      Accept payments from all major mobile money providers in Zambia.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>Integration with MTN Mobile Money, Airtel Money, and Zamtel Kwacha</li>
                          <li>Real-time payment notifications</li>
                          <li>Automatic reconciliation</li>
                          <li>Custom payment references</li>
                          <li>Detailed transaction reporting</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Link to="/checkout?method=mobile">
                            <Button className="mt-2">
                              Try Mobile Money <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">Supported Providers</h3>
                        <div className="space-y-3">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center text-white font-bold mr-3">
                              M
                            </div>
                            <div>
                              <p className="font-medium">MTN Mobile Money</p>
                              <p className="text-sm text-muted-foreground">Instant payments</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center text-white font-bold mr-3">
                              A
                            </div>
                            <div>
                              <p className="font-medium">Airtel Money</p>
                              <p className="text-sm text-muted-foreground">Instant payments</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold mr-3">
                              Z
                            </div>
                            <div>
                              <p className="font-medium">Zamtel Kwacha</p>
                              <p className="text-sm text-muted-foreground">Instant payments</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="card">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <CreditCard className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>Card Processing</CardTitle>
                    </div>
                    <CardDescription>
                      Accept Visa, Mastercard, and other card payments securely.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>PCI DSS compliant card processing</li>
                          <li>Support for major card networks</li>
                          <li>3D Secure authentication</li>
                          <li>Tokenization for repeat payments</li>
                          <li>Advanced fraud protection</li>
                          <li>Recurring billing options</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Link to="/checkout?method=card">
                            <Button className="mt-2">
                              Try Card Payment <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">Supported Cards</h3>
                        <div className="flex flex-wrap gap-3 mt-3">
                          <div className="bg-white p-2 rounded shadow-sm w-16 h-12 flex items-center justify-center">
                            <span className="font-bold text-blue-700">Visa</span>
                          </div>
                          <div className="bg-white p-2 rounded shadow-sm w-16 h-12 flex items-center justify-center">
                            <div className="flex">
                              <div className="h-4 w-4 bg-red-500 rounded-full"></div>
                              <div className="h-4 w-4 bg-yellow-500 rounded-full -ml-2"></div>
                            </div>
                          </div>
                          <div className="bg-white p-2 rounded shadow-sm w-16 h-12 flex items-center justify-center">
                            <span className="font-bold text-blue-500">UPI</span>
                          </div>
                        </div>
                        
                        <div className="mt-4">
                          <p className="text-sm text-muted-foreground">
                            All card data is securely processed according to PCI DSS standards.
                            Your customers' card information never touches your servers.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="ussd">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <Phone className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>USSD Payments</CardTitle>
                    </div>
                    <CardDescription>
                      Enable payments via USSD codes for customers without smartphones.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>Works on basic feature phones</li>
                          <li>No internet connection required</li>
                          <li>Simple customer experience</li>
                          <li>Quick payment completion</li>
                          <li>Real-time payment confirmations</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Link to="/ussd-access">
                            <Button className="mt-2">
                              Try USSD Payment <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">How It Works</h3>
                        <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
                          <li>Customer receives a unique USSD code</li>
                          <li>They dial the code on their phone</li>
                          <li>They follow the prompts to complete payment</li>
                          <li>Payment is confirmed in real-time</li>
                        </ol>
                        
                        <div className="mt-4 p-3 bg-primary/10 rounded">
                          <p className="text-sm font-medium">
                            Example USSD codes:
                          </p>
                          <div className="mt-2 space-y-1 font-mono text-sm">
                            <p>MTN: *305#</p>
                            <p>Airtel: *778#</p>
                            <p>Zamtel: *422#</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="bitcoin">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <Coins className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>Bitcoin Payments</CardTitle>
                    </div>
                    <CardDescription>
                      Accept Bitcoin and Lightning Network payments globally.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>On-chain Bitcoin transactions</li>
                          <li>Lightning Network for instant payments</li>
                          <li>QR code generation</li>
                          <li>Real-time exchange rates</li>
                          <li>Automatic settlement options</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Link to="/checkout?method=bitcoin">
                            <Button className="mt-2">
                              Try Bitcoin Payment <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">Payment Options</h3>
                        <div className="space-y-4">
                          <div>
                            <p className="font-medium">Bitcoin On-chain</p>
                            <p className="text-sm text-muted-foreground">Secure payments with blockchain confirmation</p>
                          </div>
                          
                          <div>
                            <p className="font-medium">Lightning Network</p>
                            <p className="text-sm text-muted-foreground">Instant payments with near-zero fees</p>
                          </div>
                          
                          <div className="mt-4 p-3 bg-primary/10 rounded">
                            <p className="text-sm">
                              Powered by BTCPay Server, a self-hosted, open-source payment processor.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="api">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <Globe className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>Merchant API</CardTitle>
                    </div>
                    <CardDescription>
                      Integrate our payment services directly into your applications.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>RESTful API architecture</li>
                          <li>Comprehensive documentation</li>
                          <li>Webhook notifications</li>
                          <li>Strong authentication</li>
                          <li>SDKs for popular platforms</li>
                          <li>Sandbox testing environment</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Button className="mt-2">
                            API Documentation <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">API Endpoints</h3>
                        <div className="space-y-2 font-mono text-sm">
                          <p>POST /api/v1/payments</p>
                          <p>GET /api/v1/payments/:id</p>
                          <p>POST /api/v1/refunds</p>
                          <p>GET /api/v1/merchants/balance</p>
                        </div>
                        
                        <div className="mt-4 p-3 bg-primary/10 rounded">
                          <p className="text-sm">
                            <span className="font-medium">Example request:</span>
                          </p>
                          <pre className="mt-2 text-xs overflow-x-auto">
{`POST /api/v1/payments
{
  "amount": 100,
  "currency": "ZMW",
  "payment_method": "mobile_money",
  "provider": "mtn",
  "reference": "INV-123",
  "customer": {
    "phone": "+26097XXXXXXX"
  }
}`}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="settlement">
                <Card>
                  <CardHeader>
                    <div className="flex items-center mb-2">
                      <BarChart className="h-6 w-6 text-primary mr-3" />
                      <CardTitle>Settlement Services</CardTitle>
                    </div>
                    <CardDescription>
                      Fast and reliable settlement of your payment funds.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Features</h3>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          <li>Next-day settlements to local banks</li>
                          <li>Automated settlement schedules</li>
                          <li>Multiple settlement accounts</li>
                          <li>Detailed settlement reports</li>
                          <li>Split payments functionality</li>
                          <li>Flexible settlement currencies</li>
                        </ul>
                        
                        <div className="mt-4">
                          <Button className="mt-2">
                            Learn More <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="bg-secondary/20 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2">Settlement Options</h3>
                        <div className="space-y-3">
                          <div>
                            <p className="font-medium">Daily Settlement</p>
                            <p className="text-sm text-muted-foreground">Receive funds the next business day</p>
                          </div>
                          
                          <div>
                            <p className="font-medium">Weekly Settlement</p>
                            <p className="text-sm text-muted-foreground">Consolidated weekly transfers</p>
                          </div>
                          
                          <div>
                            <p className="font-medium">Custom Schedule</p>
                            <p className="text-sm text-muted-foreground">Define your own settlement frequency</p>
                          </div>
                        </div>
                        
                        <div className="mt-4 p-3 bg-primary/10 rounded">
                          <p className="text-sm">
                            Supported with all major Zambian banks, including Zanaco, Stanbic, FNB, and more.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            
            {/* Integration Process */}
            <div className="mb-16">
              <h2 className="text-2xl font-bold mb-6 text-center">Integration Process</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                      <span className="text-xl font-bold text-primary">1</span>
                    </div>
                    <h3 className="text-lg font-medium mb-2">Register</h3>
                    <p className="text-muted-foreground">
                      Create a merchant account and complete the KYC verification process.
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                      <span className="text-xl font-bold text-primary">2</span>
                    </div>
                    <h3 className="text-lg font-medium mb-2">Configure</h3>
                    <p className="text-muted-foreground">
                      Set up your business profile, payment methods, and settlement accounts.
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                      <span className="text-xl font-bold text-primary">3</span>
                    </div>
                    <h3 className="text-lg font-medium mb-2">Integrate</h3>
                    <p className="text-muted-foreground">
                      Add our payment solutions to your website or application using our APIs or plugins.
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                      <span className="text-xl font-bold text-primary">4</span>
                    </div>
                    <h3 className="text-lg font-medium mb-2">Go Live</h3>
                    <p className="text-muted-foreground">
                      Start accepting payments and monitor your transactions in real-time.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
            
            {/* Call to Action */}
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4">Ready to start accepting payments?</h2>
              <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                Join hundreds of businesses in Zambia who trust BMaGlass Pay for their payment processing needs.
              </p>
              
              <div className="flex flex-wrap justify-center gap-4">
                <Link to="/register">
                  <Button size="lg">
                    Create Account
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button variant="outline" size="lg">
                    Contact Sales
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default PaymentServices;
