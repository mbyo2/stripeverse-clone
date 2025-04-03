
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const TermsOfService = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        
        <div className="prose max-w-none">
          <p className="text-muted-foreground mb-8">
            Last updated: April 3, 2025
          </p>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p>
              Welcome to BMaGlass Pay ("Company", "we", "our", "us"). These Terms of Service ("Terms") govern your use of our website and payment processing services. By accessing or using our service, you agree to be bound by these Terms.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. Account Registration</h2>
            <p className="mb-4">
              When you create an account with us, you guarantee that the information you provide is accurate, complete, and current at all times. Inaccurate, incomplete, or obsolete information may result in the immediate termination of your account.
            </p>
            <p>
              You are responsible for maintaining the confidentiality of your account and password, including but not limited to restricting access to your computer and/or account. You agree to accept responsibility for any and all activities or actions that occur under your account and/or password.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. Payment Services</h2>
            <p className="mb-4">
              BMaGlass Pay provides various payment processing services including but not limited to mobile money integration, card processing, USSD payments, and cryptocurrency transactions. By using our services, you agree to comply with all applicable laws and regulations.
            </p>
            <p className="mb-4">
              We maintain the right to refuse service to anyone for any reason at any time. All payment transactions are subject to verification and approval by our fraud prevention systems.
            </p>
            <p>
              Transactions may be delayed or declined if our systems detect unusual or suspicious activity. We reserve the right to hold funds pending verification of compliance with our terms of service.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. User Obligations</h2>
            <p className="mb-4">
              You may not use our services for any illegal or unauthorized purpose. You agree not to transmit any material that contains software viruses or any computer code designed to disrupt, damage, or limit the functioning of any computer software or hardware.
            </p>
            <p>
              You agree not to engage in any activity that may cause us to violate any applicable law or regulation, including but not limited to money laundering, fraud, or financing of illegal activities.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Fees and Charges</h2>
            <p className="mb-4">
              Our fees for payment processing services vary depending on the payment method and transaction volume. All applicable fees will be disclosed to you prior to completing any transaction.
            </p>
            <p>
              We reserve the right to change our fees at any time with prior notice. Continued use of our services after such changes constitutes your consent to such changes.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Limitation of Liability</h2>
            <p>
              In no event shall BMaGlass Pay, its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the service.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Governing Law</h2>
            <p>
              These Terms shall be governed and construed in accordance with the laws of Zambia, without regard to its conflict of law provisions. Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">8. Changes to Terms</h2>
            <p>
              We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.
            </p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-4">9. Contact Us</h2>
            <p>
              If you have any questions about these Terms, please contact us at legal@bmaglasspay.com.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TermsOfService;
