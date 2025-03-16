
import { useEffect, useRef } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const TermsOfService = () => {
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
            className="opacity-0 prose prose-lg max-w-none"
          >
            <h1 className="text-3xl font-bold mb-8 text-center">Terms of Service</h1>
            
            <div className="bg-white rounded-lg shadow-sm p-8">
              <p className="text-sm text-gray-500 mb-6">Last Updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              
              <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
              <p className="mb-6">
                Welcome to BMaGlass Pay, founded by Mabvuto Banda. These Terms of Service ("Terms") govern your access to and use of our payment processing services, website, and mobile application (collectively, the "Service"). By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the Service.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
              <p className="mb-6">
                BMaGlass Pay is a payment gateway service that enables businesses in Zambia to process payments from various sources including mobile money, bank transfers, and card payments. Our service allows merchants to accept payments from customers through our secure payment processing system.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">3. Account Registration</h2>
              <p className="mb-6">
                To use certain features of the Service, you must register for an account. You must provide accurate, current, and complete information during the registration process and keep your account information up-to-date. You are responsible for safeguarding your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">4. Merchant Obligations</h2>
              <p className="mb-3">As a merchant using our Service, you agree to:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Comply with all applicable laws and regulations, including those related to financial services in Zambia</li>
                <li>Provide accurate business information during registration</li>
                <li>Maintain appropriate security measures to protect customer data</li>
                <li>Not use our Service for any illegal or unauthorized purpose</li>
                <li>Pay all applicable fees and charges for using our Service</li>
                <li>Promptly respond to customer inquiries and disputes</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">5. Payment Processing</h2>
              <p className="mb-6">
                We provide payment processing services subject to the terms and conditions of this agreement. We will process payments on your behalf and transfer funds to your designated account according to our settlement schedule. Transaction fees will be deducted from the settlement amount or charged separately, as specified in your merchant agreement.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">6. Fees and Payments</h2>
              <p className="mb-6">
                Fees for using our Service are outlined in your merchant agreement. We reserve the right to change our fees with prior notice. All fees are quoted in Zambian Kwacha (ZMW) unless otherwise specified. Late payments may result in additional charges or suspension of your account.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">7. Prohibited Activities</h2>
              <p className="mb-3">You agree not to use our Service for:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Any illegal activities or goods</li>
                <li>Intellectual property infringement</li>
                <li>Products or services that violate Bank of Zambia regulations</li>
                <li>Processing payments for high-risk or prohibited businesses without prior approval</li>
                <li>Creating fake transactions or engaging in money laundering</li>
                <li>Any activity that could damage our reputation or services</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
              <p className="mb-6">
                To the maximum extent permitted by law, BMaGlass Pay shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from your use of our Service.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">9. Indemnification</h2>
              <p className="mb-6">
                You agree to indemnify, defend, and hold harmless BMaGlass Pay and its officers, directors, employees, agents, and affiliates from and against any claims, disputes, demands, liabilities, damages, losses, and expenses, including reasonable legal and accounting fees, arising out of or in any way connected with your access to or use of the Service or your violation of these Terms.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">10. Modifications to Terms</h2>
              <p className="mb-6">
                We reserve the right to modify these Terms at any time. If we make changes, we will provide notice of such changes by updating the date at the top of these Terms. Your continued use of the Service following the posting of revised Terms means that you accept and agree to the changes.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">11. Termination</h2>
              <p className="mb-6">
                We may terminate or suspend your account and access to the Service immediately, without prior notice or liability, for any reason, including if you breach these Terms. Upon termination, your right to use the Service will immediately cease.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">12. Governing Law</h2>
              <p className="mb-6">
                These Terms shall be governed by and construed in accordance with the laws of Zambia, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be resolved exclusively in the courts of Zambia.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">13. Contact Information</h2>
              <p className="mb-6">
                For questions about these Terms, please contact us at:<br />
                Email: legal@bmaglasspay.com<br />
                Phone: +260 976 123 456<br />
                Address: Cairo Road, Lusaka, Zambia
              </p>
            </div>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default TermsOfService;
