
import { useEffect, useRef } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Shield, Check, AlertTriangle, CreditCard, FileCheck, Lock, Eye } from 'lucide-react';

const Compliance = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  
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

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-grow pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div 
            ref={contentRef}
            className="opacity-0"
          >
            <h1 className="text-3xl font-bold mb-8 text-center">Compliance & Security</h1>
            
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <div className="flex items-center justify-center mb-6">
                <Shield className="h-16 w-16 text-primary" />
              </div>
              
              <p className="text-center text-lg mb-8">
                BMaGlass Pay is committed to maintaining the highest standards of compliance and security in all our operations. As a Bank of Zambia approved payment service provider, we adhere to all relevant financial regulations and industry best practices.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="border border-border rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Regulatory Compliance</h2>
                  <ul className="space-y-3">
                    <li className="flex items-start">
                      <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                      <span>Licensed and regulated by the Bank of Zambia</span>
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
                    <li className="flex items-start">
                      <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                      <span>Full Bank of Zambia certification (License #BOZ/PSP/2023/42)</span>
                    </li>
                  </ul>
                </div>
                
                <div className="border border-border rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Security Standards</h2>
                  <ul className="space-y-3">
                    <li className="flex items-start">
                      <Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                      <span>PCI DSS Level 1 compliant (Payment Card Industry Data Security Standard)</span>
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
                      <span>SOC 2 Type II audited data centers</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            
            {/* PCI DSS Compliance Section */}
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <h2 className="text-xl font-semibold mb-6 flex items-center">
                <CreditCard className="h-5 w-5 mr-2 text-primary" />
                PCI DSS Compliance
              </h2>
              
              <p className="mb-6">
                The Payment Card Industry Data Security Standard (PCI DSS) is a set of security standards designed to ensure that all companies that accept, process, store, or transmit credit card information maintain a secure environment.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-secondary/10 rounded-lg p-6">
                  <h3 className="font-medium mb-3">What PCI DSS Level 1 Means</h3>
                  <p className="text-foreground/70 mb-3">
                    As a Level 1 PCI DSS certified service provider, BMaGlass Pay meets the highest level of security requirements, including:
                  </p>
                  <ul className="space-y-2 pl-5 list-disc text-foreground/70">
                    <li>Annual on-site security assessments by a Qualified Security Assessor (QSA)</li>
                    <li>Quarterly network scans by an Approved Scanning Vendor (ASV)</li>
                    <li>Penetration testing and internal vulnerability assessments</li>
                    <li>Maintaining a secure network and systems</li>
                    <li>Protecting cardholder data with encryption and tokenization</li>
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
                <h3 className="font-medium mb-2">Our PCI DSS Compliance Process</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col items-center text-center p-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                      <FileCheck className="h-6 w-6 text-primary" />
                    </div>
                    <h4 className="font-medium mb-1">Assessment</h4>
                    <p className="text-sm text-foreground/70">Annual security assessments by certified QSA</p>
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
                    <p className="text-sm text-foreground/70">24/7 security monitoring and quarterly scans</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Bank of Zambia Approval Section */}
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <h2 className="text-xl font-semibold mb-6">Bank of Zambia Approval</h2>
              
              <p className="mb-6">
                BMaGlass Pay is fully licensed and regulated by the Bank of Zambia under the National Payment Systems Act. Our operations comply with all relevant regulations and directives issued by the Bank of Zambia for payment service providers.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-secondary/10 rounded-lg p-6">
                  <h3 className="font-medium mb-3">Licensing Requirements</h3>
                  <p className="text-foreground/70">
                    We meet all requirements for payment service providers in Zambia, including capital requirements, governance structures, and operational capabilities.
                  </p>
                </div>
                
                <div className="bg-secondary/10 rounded-lg p-6">
                  <h3 className="font-medium mb-3">Regulatory Reporting</h3>
                  <p className="text-foreground/70">
                    We submit regular reports to the Bank of Zambia on transaction volumes, suspicious activities, and other regulatory requirements.
                  </p>
                </div>
                
                <div className="bg-secondary/10 rounded-lg p-6">
                  <h3 className="font-medium mb-3">Consumer Protection</h3>
                  <p className="text-foreground/70">
                    We adhere to all consumer protection guidelines issued by the Bank of Zambia, ensuring transparent and fair services for all users.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
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
            
            <div className="bg-white rounded-lg shadow-sm p-8">
              <h2 className="text-xl font-semibold mb-6">Merchant Compliance Requirements</h2>
              
              <div className="mb-8">
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6">
                  <div className="flex">
                    <AlertTriangle className="h-6 w-6 text-amber-500 mr-3 flex-shrink-0" />
                    <p className="text-amber-700">
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
                  For compliance inquiries, please contact:<br />
                  <span className="font-medium">compliance@bmaglasspay.com</span> or call <span className="font-medium">+260 976 123 456</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default Compliance;
