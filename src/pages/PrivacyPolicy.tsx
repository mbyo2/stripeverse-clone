
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        
        <div className="prose max-w-none text-foreground">
          <p className="text-muted-foreground mb-8">Last updated: March 5, 2026</p>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground">BMaGlass Pay ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our payment processing services. Please read this policy carefully.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
            <p className="text-muted-foreground mb-4">We collect several types of information:</p>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>Personal identifying information (name, email, phone number)</li>
              <li>Financial information (payment card details, bank account, mobile money numbers)</li>
              <li>Identity verification documents (government ID, selfie, proof of address)</li>
              <li>Transaction data (purchase history, payment amounts, merchants)</li>
              <li>Technical data (IP address, browser type, device information)</li>
              <li>Usage data (feature interactions, login patterns)</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>Processing payment transactions and settlements</li>
              <li>Identity verification and KYC compliance</li>
              <li>Detecting and preventing fraud</li>
              <li>Complying with Bank of Zambia regulations and AML requirements</li>
              <li>Providing customer support</li>
              <li>Improving our services and developing new features</li>
              <li>Marketing communications (with your consent only)</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. Data Protection and Security</h2>
            <p className="text-muted-foreground mb-4">We implement robust security measures:</p>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>AES-256 encryption for sensitive data at rest</li>
              <li>TLS 1.3 for all data in transit</li>
              <li>PCI DSS Level 1 compliance for card data</li>
              <li>Field-level encryption for virtual card details</li>
              <li>Two-factor authentication and biometric verification</li>
              <li>Regular security audits and penetration testing</li>
              <li>Role-based access controls for internal systems</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Disclosure of Information</h2>
            <p className="text-muted-foreground mb-4">We may disclose your personal information:</p>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>To payment processors and banks to complete transactions</li>
              <li>To mobile money providers (MTN, Airtel, Zamtel) for mobile payments</li>
              <li>To regulatory authorities as required by law</li>
              <li>To fraud prevention and identity verification services</li>
              <li>To enforce our Terms of Service</li>
            </ul>
            <p className="text-muted-foreground">We never sell your personal data to third parties.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Data Retention</h2>
            <p className="text-muted-foreground">We retain personal data for as long as your account is active. Transaction records are retained for 7 years as required by Zambian financial regulations. You may request deletion of non-regulatory data at any time.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Your Rights</h2>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion (subject to regulatory requirements)</li>
              <li>Restrict or object to processing</li>
              <li>Data portability</li>
              <li>Withdraw consent at any time</li>
            </ul>
            <p className="text-muted-foreground">Contact privacy@bmaglasspay.com to exercise these rights.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">8. Children's Privacy</h2>
            <p className="text-muted-foreground">Our services are not intended for individuals under 18. We do not knowingly collect personal information from children.</p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-4">9. Contact Us</h2>
            <p className="text-muted-foreground">For privacy questions, contact us at privacy@bmaglasspay.com or write to: BMaGlass Pay, Cairo Road, Lusaka, Zambia.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
