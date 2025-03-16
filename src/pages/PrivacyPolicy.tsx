
import { useEffect, useRef } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const PrivacyPolicy = () => {
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
            <h1 className="text-3xl font-bold mb-8 text-center">Privacy Policy</h1>
            
            <div className="bg-white rounded-lg shadow-sm p-8">
              <p className="text-sm text-gray-500 mb-6">Last Updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              
              <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
              <p className="mb-6">
                BMaGlass Pay ("we", "our", or "us"), founded by Mabvuto Banda, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our payment processing services, website, or mobile application (collectively, the "Service"). Please read this privacy policy carefully. If you do not agree with the terms of this privacy policy, please do not access the Service.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
              <p className="mb-3">We collect information that you provide directly to us when you:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Register for an account</li>
                <li>Process a payment</li>
                <li>Contact customer service</li>
                <li>Complete a transaction via our payment gateway</li>
                <li>Respond to a survey or marketing communication</li>
              </ul>
              
              <p className="mb-3">This information may include:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Personal identification information (name, email address, phone number, etc.)</li>
                <li>Billing information and payment details</li>
                <li>Business information for merchant accounts</li>
                <li>Transaction history</li>
                <li>Device information and usage data</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
              <p className="mb-3">We may use the information we collect for various purposes, including to:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Process payments and complete transactions</li>
                <li>Provide, maintain, and improve our services</li>
                <li>Send transaction confirmations and receipts</li>
                <li>Detect and prevent fraud and unauthorized activities</li>
                <li>Comply with Bank of Zambia regulations and other legal requirements</li>
                <li>Respond to customer service inquiries</li>
                <li>Send marketing communications (with your consent)</li>
                <li>Monitor usage patterns and analyze trends</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">4. Data Security</h2>
              <p className="mb-6">
                We implement appropriate technical and organizational measures to maintain the safety of your personal information. All payment information is encrypted using industry-standard technology. However, no method of transmission over the Internet or electronic storage is 100% secure, so we cannot guarantee absolute security.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">5. Disclosure of Your Information</h2>
              <p className="mb-3">We may share your information with:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Financial institutions and payment processors to complete transactions</li>
                <li>Service providers who perform services on our behalf</li>
                <li>Law enforcement or government officials when required by law</li>
                <li>Other parties in connection with a merger, acquisition, or sale of assets</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">6. Data Retention</h2>
              <p className="mb-6">
                We will retain your information for as long as your account is active or as needed to provide you services. We will also retain and use your information as necessary to comply with legal obligations, resolve disputes, and enforce our agreements.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">7. Your Rights</h2>
              <p className="mb-3">You have the right to:</p>
              <ul className="list-disc pl-8 mb-6">
                <li>Access the personal information we hold about you</li>
                <li>Request correction of inaccurate personal information</li>
                <li>Request deletion of your personal information (subject to legal requirements)</li>
                <li>Object to processing of your personal information</li>
                <li>Request restriction of processing of your personal information</li>
                <li>Request transfer of your personal information</li>
                <li>Opt out of marketing communications</li>
              </ul>
              
              <h2 className="text-xl font-semibold mb-4">8. Changes to This Privacy Policy</h2>
              <p className="mb-6">
                We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date at the top of this page.
              </p>
              
              <h2 className="text-xl font-semibold mb-4">9. Contact Us</h2>
              <p className="mb-6">
                If you have any questions about this Privacy Policy, please contact us at:<br />
                Email: privacy@bmaglasspay.com<br />
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

export default PrivacyPolicy;
