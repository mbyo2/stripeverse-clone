
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const TermsOfService = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        
        <div className="prose max-w-none text-foreground">
          <p className="text-muted-foreground mb-8">Last updated: March 5, 2026</p>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground">Welcome to BMaGlass Pay ("Company", "we", "our", "us"). These Terms of Service ("Terms") govern your use of our website, mobile applications, and payment processing services. By accessing or using our service, you agree to be bound by these Terms.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. Account Registration</h2>
            <p className="text-muted-foreground mb-4">You must provide accurate, complete, and current information. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You must be at least 18 years old to create an account.</p>
            <p className="text-muted-foreground">Identity verification (KYC) is required to access full platform features including transfers, virtual cards, and higher transaction limits.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. Payment Services</h2>
            <p className="text-muted-foreground mb-4">BMaGlass Pay provides payment processing services including mobile money integration, card processing, USSD payments, virtual cards, Bitcoin transactions, and merchant payment APIs.</p>
            <p className="text-muted-foreground mb-4">All transactions are subject to our fraud prevention systems. Transactions may be delayed or declined if unusual or suspicious activity is detected. We reserve the right to hold funds pending compliance verification.</p>
            <p className="text-muted-foreground">Settlement times vary: Mobile Money (instant), Card payments (1-2 business days), Bank transfers (1-3 business days).</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. Fees and Charges</h2>
            <p className="text-muted-foreground mb-4">Transaction fees vary by payment method and subscription tier. All applicable fees are disclosed before completing any transaction. Current fee schedules are available on our Pricing page.</p>
            <p className="text-muted-foreground">We may change fees with 30 days' prior notice. Continued use after changes constitutes acceptance.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. User Obligations</h2>
            <p className="text-muted-foreground mb-4">You agree not to:</p>
            <ul className="list-disc pl-5 mb-4 text-muted-foreground space-y-1">
              <li>Use our services for illegal or unauthorised purposes</li>
              <li>Engage in money laundering, fraud, or financing of illegal activities</li>
              <li>Attempt to circumvent security measures or rate limits</li>
              <li>Share account credentials or allow unauthorised access</li>
              <li>Use automated systems to access our services without permission</li>
              <li>Transmit malware or harmful code</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Virtual Cards</h2>
            <p className="text-muted-foreground">Virtual cards are issued for online transactions. Card usage is subject to daily and monthly limits based on your subscription tier. We may freeze or cancel cards if fraudulent activity is detected. Card balances are not insured deposits.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Disputes and Refunds</h2>
            <p className="text-muted-foreground">Transaction disputes must be filed within 30 days. We review disputes within 3-5 business days. Refunds, if approved, are credited to your original payment method. Dispute decisions may be appealed once within 14 days.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
            <p className="text-muted-foreground">BMaGlass Pay shall not be liable for indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, resulting from your use of or inability to use the service. Our total liability shall not exceed the fees paid by you in the 12 months preceding the claim.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">9. Governing Law</h2>
            <p className="text-muted-foreground">These Terms are governed by the laws of the Republic of Zambia. Any disputes shall be resolved in the courts of Zambia.</p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">10. Account Termination</h2>
            <p className="text-muted-foreground">We may suspend or terminate your account for violation of these Terms, suspected fraud, or regulatory requirements. You may close your account at any time by contacting support. Outstanding balances will be settled within 30 days of closure.</p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-4">11. Contact Us</h2>
            <p className="text-muted-foreground">For questions about these Terms, contact legal@bmaglasspay.com or write to: BMaGlass Pay, Cairo Road, Lusaka, Zambia.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TermsOfService;
