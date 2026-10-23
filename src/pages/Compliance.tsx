import { useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Shield, Check, AlertTriangle, CreditCard, FileCheck, Lock, Eye, Download, FileBadge, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from 'react-router-dom';
import KycVerificationStatus, { KycLevel, KycStatus } from '@/components/wallet/KycVerificationStatus';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import BusinessCompliance from '@/components/business/BusinessCompliance';

const Compliance = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [kycLevel, setKycLevel] = useState<KycLevel>(KycLevel.NONE);
  const [kycStatus, setKycStatus] = useState<KycStatus>(KycStatus.NOT_STARTED);
  const [loading, setLoading] = useState(true);
  const [complianceScore, setComplianceScore] = useState(0);
  const [documentList, setDocumentList] = useState([
    { id: 1, name: 'Terms of Service', accepted: false },
    { id: 2, name: 'Privacy Policy', accepted: false },
    { id: 3, name: 'AML Policy', accepted: false },
    { id: 4, name: 'KYC Requirements', accepted: false }
  ]);
  
  useEffect(() => {
    const fetchKycStatus = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        
        const { data, error } = await supabase.functions.invoke('mobile-money', {
          body: {
            paymentMethod: 'check-kyc',
            userId: user.id
          }
        });
        
        if (error) throw error;
        
        setKycLevel(data.level as KycLevel);
        
        const { data: kycData, error: kycError } = await supabase
          .from('kyc_verifications')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
          
        if (kycError && kycError.code !== 'PGRST116') {
          throw kycError;
        }
        
        if (kycData) {
          if (kycData.verified_at) {
            setKycStatus(KycStatus.APPROVED);
          } else if (kycData.id_number) {
            setKycStatus(KycStatus.PENDING);
          }
          
          if (kycData.metadata && typeof kycData.metadata === 'object') {
            const metadata = kycData.metadata as Record<string, unknown>;
            if (metadata.rejection_reason) {
              setKycStatus(KycStatus.REJECTED);
            }
          }
        }
        
        calculateComplianceScore(data.level as KycLevel);
      } catch (error) {
        console.error("Error fetching KYC status:", error);
        toast({
          title: "Error",
          description: "Failed to fetch verification status",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchKycStatus();
  }, [user, toast]);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          contentRef.current?.classList.add('animate-fadeIn');
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
  
  const handleDocumentAccept = (id: number) => {
    setDocumentList(prev => 
      prev.map(doc => 
        doc.id === id ? { ...doc, accepted: !doc.accepted } : doc
      )
    );
    
    setTimeout(() => {
      calculateComplianceScore(kycLevel);
    }, 100);
  };
  
  const calculateComplianceScore = (level: KycLevel) => {
    let score = 0;
    
    switch(level) {
      case KycLevel.FULL:
        score += 60;
        break;
      case KycLevel.BASIC:
        score += 30;
        break;
      case KycLevel.NONE:
        score += 0;
        break;
    }
    
    const acceptedDocsCount = documentList.filter(doc => doc.accepted).length;
    score += acceptedDocsCount * 10;
    
    setComplianceScore(score);
  };
  
  const downloadDocument = (documentName: string) => {
    toast({
      title: "Document Download",
      description: `${documentName} would be downloaded in a real implementation.`,
    });
  };
  
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      
      <main className="flex-grow pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div 
            ref={contentRef}
            className="opacity-0"
          >
            <h1 className="text-3xl font-bold mb-8 text-center">Compliance & Security</h1>
            
            {user ? (
              <div className="bg-card rounded-lg shadow-sm p-8 mb-8 border border-border">
                <Tabs defaultValue="status">
                  <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
                    <TabsTrigger value="status">Compliance Status</TabsTrigger>
                    <TabsTrigger value="documents">Required Documents</TabsTrigger>
                    <TabsTrigger value="aml">AML Screening</TabsTrigger>
                    <TabsTrigger value="info">Compliance Info</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="status" className="mt-6">
                    <div className="space-y-8">
                       <div className="bg-card border border-border rounded-lg p-6">
                        <h2 className="text-lg font-semibold mb-4">Your Compliance Score</h2>
                        <div className="mb-2 flex justify-between">
                          <span className="text-sm text-muted-foreground">Compliance Level: {complianceScore}%</span>
                          <span className="text-sm font-medium">
                            {complianceScore < 40 ? 'Non-Compliant' : 
                             complianceScore < 70 ? 'Partially Compliant' : 
                             'Fully Compliant'}
                          </span>
                        </div>
                        <Progress value={complianceScore} className="h-2" />
                        
                        <div className="mt-8">
                          <h3 className="font-medium mb-3">Compliance Requirements</h3>
                          <ul className="space-y-3">
                            <li className="flex items-start">
                              {kycLevel !== KycLevel.NONE ? 
                                <CheckCircle className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" /> : 
                                <AlertTriangle className="h-5 w-5 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
                              }
                              <span>Identity Verification (KYC)</span>
                            </li>
                            <li className="flex items-start">
                              {documentList.filter(d => d.accepted).length === documentList.length ? 
                                <CheckCircle className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" /> : 
                                <AlertTriangle className="h-5 w-5 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
                              }
                              <span>Policy Acceptance</span>
                            </li>
                          </ul>
                          
                          <div className="mt-6">
                            <KycVerificationStatus level={kycLevel} status={kycStatus} />
                          </div>
                          
                          <div className="mt-6">
                            <Button 
                              onClick={() => navigate('/wallet')}
                              variant="outline"
                            >
                              Update KYC Verification
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="documents" className="mt-6">
                    <div className="space-y-6">
                      {documentList.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between border-b border-border pb-4">
                          <div className="flex items-center">
                            <FileBadge className="h-5 w-5 text-primary mr-3" />
                            <span>{doc.name}</span>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => downloadDocument(doc.name)}
                            >
                              <Download className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button 
                              variant={doc.accepted ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleDocumentAccept(doc.id)}
                            >
                              {doc.accepted ? 'Accepted' : 'Accept'}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="bg-accent/50 p-4 rounded-lg mt-6 border border-accent">
                      <p className="text-sm text-muted-foreground">
                        You need to review and accept all policy documents to achieve full compliance status.
                        This will ensure that you understand our terms, privacy policies, and anti-money laundering requirements.
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="aml" className="mt-6">
                    <div className="space-y-4">
                      <p className="text-muted-foreground text-sm mb-4">
                        Anti-Money Laundering screenings help ensure regulatory compliance. Screen individuals and entities against global sanctions lists.
                      </p>
                      <Button onClick={() => navigate('/aml-screening')}>
                        <Shield className="h-4 w-4 mr-2" /> Open AML Screening Dashboard
                      </Button>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="info" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="border border-border rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Regulatory Compliance</h2>
                        <ul className="space-y-3">
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Bank of Zambia authorisation in progress — approval pending</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Compliant with the National Payment Systems Act of Zambia</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Adherence to Anti-Money Laundering (AML) regulations</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Know Your Customer (KYC) verification procedures</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Regular compliance audits and reporting</span>
                          </li>
                        </ul>
                      </div>
                      
                      <div className="border border-border rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Security Standards</h2>
                        <ul className="space-y-3">
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Card data encrypted in transit and stored only as tokens — raw card numbers are never kept on our servers</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>256-bit SSL encryption for all transactions</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Tokenization of sensitive payment information</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Real-time fraud monitoring and prevention</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Regular penetration testing and security assessments</span>
                          </li>
                          <li className="flex items-start">
                            <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>Role-based access controls and audit logging on platform data</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                    
                    <div className="bg-card rounded-lg shadow-sm p-8 mb-8 mt-8 border border-border">
                      <h2 className="text-xl font-semibold mb-6 flex items-center">
                        <CreditCard className="h-5 w-5 mr-2 text-primary" />
                        PCI DSS & Card Data
                      </h2>
                      
                      <p className="mb-6">
                        The Payment Card Industry Data Security Standard (PCI DSS) is a set of security standards designed to ensure that all companies that accept, process, store, or transmit credit card information maintain a secure environment.
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">How BMaGlass Pay Handles Card Data</h3>
                          <p className="text-foreground/70 mb-3">
                            BMaGlass Pay is not itself a PCI DSS-certified processor. We handle card data with PCI DSS-aligned controls:
                          </p>
                          <ul className="space-y-2 pl-5 list-disc text-foreground/70">
                            <li>Card numbers encrypted in transit on every transaction</li>
                            <li>Cards stored as tokens — raw card numbers are never stored in our database</li>
                            <li>CVV security codes are never stored</li>
                            <li>Two-factor authentication and role-based access on accounts</li>
                            <li>Transactions monitored for fraud in real time</li>
                          </ul>
                        </div>
                        
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Benefits for Merchants</h3>
                          <ul className="space-y-2 pl-5 list-disc text-foreground/70">
                            <li>Reduced risk of data breaches and fraud</li>
                            <li>Protection against financial penalties and legal costs</li>
                            <li>Increased customer trust and confidence</li>
                            <li>Simplified compliance requirements</li>
                            <li>Better protection of your business reputation</li>
                            <li>Lower risk of reputational damage from breaches</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="border border-border p-4 rounded-lg">
                        <h3 className="font-medium mb-2">Our Card-Security Process</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="flex flex-col items-center text-center p-3">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                              <FileCheck className="h-6 w-6 text-primary" />
                            </div>
                            <h4 className="font-medium mb-1">Assessment</h4>
                            <p className="text-sm text-foreground/70">Regular reviews of our card-handling controls</p>
                          </div>
                          
                          <div className="flex flex-col items-center text-center p-3">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                              <Lock className="h-6 w-6 text-primary" />
                            </div>
                            <h4 className="font-medium mb-1">Implementation</h4>
                            <p className="text-sm text-foreground/70">Continuous security measures and controls</p>
                          </div>
                          
                          <div className="flex flex-col items-center text-center p-3">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                              <Eye className="h-6 w-6 text-primary" />
                            </div>
                            <h4 className="font-medium mb-1">Monitoring</h4>
                            <p className="text-sm text-foreground/70">Continuous monitoring of transactions and access</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-card rounded-lg shadow-sm p-8 mb-8 border border-border">
                      <h2 className="text-xl font-semibold mb-6">Regulatory Status</h2>

                      <p className="mb-6">
                        BMaGlass Pay's authorisation by the Bank of Zambia is currently pending. We are in the approval process to operate as a payment service provider under the National Payment Systems Act, and we are building our operations to comply with the regulations and directives the Bank of Zambia issues for payment service providers.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Authorisation Process</h3>
                          <p className="text-foreground/70">
                            We are working through the Bank of Zambia's authorisation process, building our capital, governance structures, and operational capabilities to meet its requirements for payment service providers.
                          </p>
                        </div>

                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Reporting Readiness</h3>
                          <p className="text-foreground/70">
                            We keep full transaction records and operate AML monitoring so that we can meet regulatory reporting requirements — including reporting on transaction volumes and suspicious activities — as our authorisation progresses.
                          </p>
                        </div>

                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Consumer Protection</h3>
                          <p className="text-foreground/70">
                            We build our services around the Bank of Zambia's consumer protection guidelines, ensuring transparent and fair services for all users.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-card rounded-lg shadow-sm p-8 border border-border">
                      <h2 className="text-xl font-semibold mb-6">Our Compliance Commitments</h2>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Data Protection</h3>
                          <p className="text-foreground/70">
                            We comply with data protection laws and regulations to ensure the privacy and security of your personal and financial information.
                          </p>
                        </div>
                        
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Transparent Practices</h3>
                          <p className="text-foreground/70">
                            We maintain clear and open communication about our fees, terms of service, and privacy practices.
                          </p>
                        </div>
                        
                        <div className="bg-secondary/10 rounded-lg p-6">
                          <h3 className="font-medium mb-3">Risk Management</h3>
                          <p className="text-foreground/70">
                            We implement comprehensive risk management practices to protect our platform and our users from fraud and security threats.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-card rounded-lg shadow-sm p-8 border border-border">
                      <h2 className="text-xl font-semibold mb-6">Merchant Compliance Requirements</h2>
                      
                      <div className="mb-8">
                        <div className="bg-accent/50 border-l-4 border-amber-500 p-4 mb-6">
                          <div className="flex">
                            <AlertTriangle className="h-6 w-6 text-amber-500 mr-3 flex-shrink-0" />
                            <p className="text-muted-foreground">
                              As a merchant using BMaGlass Pay, you are required to comply with certain standards to maintain a secure payment environment.
                            </p>
                          </div>
                        </div>
                        
                        <h3 className="font-medium mb-3">Merchant Requirements:</h3>
                        <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                          <li>Maintain the confidentiality of your merchant account credentials</li>
                          <li>Implement appropriate security measures on your website or application</li>
                          <li>Properly display privacy policy and terms of service to your customers</li>
                          <li>Comply with all applicable laws and regulations in Zambia</li>
                          <li>Promptly notify BMaGlass Pay of any security incidents or breaches</li>
                          <li>Retain transaction records for at least five years</li>
                          <li>Only process transactions for goods and services that comply with our acceptable use policy</li>
                        </ul>
                      </div>
                      
                      <div className="border-t border-border pt-6">
                        <h3 className="font-medium mb-3">Compliance Support</h3>
                        <p className="text-foreground/70 mb-4">
                          Our compliance team, led by Mabvuto Banda, is available to assist you with any compliance-related questions or concerns. We offer resources and guidance to help you maintain compliance with all relevant regulations.
                        </p>
                        <p className="text-foreground/70">
                          For compliance inquiries, please reach us through the{" "}
                          <Link to="/contact" className="font-medium text-primary hover:underline">contact form</Link>{" "}
                          or a{" "}
                          <Link to="/support" className="font-medium text-primary hover:underline">support ticket</Link>.
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="bg-card rounded-lg shadow-sm p-8 mb-8 text-center border border-border">
                <Shield className="h-12 w-12 mx-auto text-primary mb-4" />
                <h2 className="text-xl font-semibold mb-3">Authentication Required</h2>
                <p className="mb-6">Please log in to view your compliance status and required actions.</p>
                <Button onClick={() => navigate('/login')}>
                  Log In to Continue
                </Button>
              </div>
            )}
            
            <div className="bg-card rounded-lg shadow-sm p-8 mb-8 border border-border">
              <div className="flex items-center justify-center mb-6">
                <Shield className="h-16 w-16 text-primary" />
              </div>
              
              <p className="text-center text-lg mb-8">
                BMaGlass Pay is committed to maintaining the highest standards of compliance and security in all our operations. While our Bank of Zambia authorisation is in progress, we adhere to all relevant financial regulations and industry best practices.
              </p>
            </div>
            
            {user && (
              <BusinessCompliance />
            )}
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default Compliance;
