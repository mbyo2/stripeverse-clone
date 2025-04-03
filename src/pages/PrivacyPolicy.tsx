
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        
        <div className="prose max-w-none">
          <p className="text-muted-foreground mb-8">
            Last updated: April 3, 2025
          </p>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p>
              BMaGlass Pay ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our payment processing services. Please read this policy carefully to understand our practices regarding your personal data.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
            <p className="mb-4">
              We collect several types of information from and about users of our services, including:
            </p>
            <ul className="list-disc pl-5 mb-4">
              <li>Personal identifying information (e.g., name, email address, phone number)</li>
              <li>Financial information (e.g., payment card details, bank account information)</li>
              <li>Transaction data (e.g., purchase history, payment amounts)</li>
              <li>Technical data (e.g., IP address, browser type, device information)</li>
              <li>Usage data (e.g., how you interact with our services)</li>
            </ul>
            <p>
              We collect this information directly from you when you provide it to us, automatically as you navigate through our platform, and from third-party sources such as business partners and service providers.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
            <p className="mb-4">
              We use the information we collect for various purposes, including:
            </p>
            <ul className="list-disc pl-5 mb-4">
              <li>Processing payment transactions</li>
              <li>Providing and maintaining our services</li>
              <li>Detecting and preventing fraud</li>
              <li>Complying with legal obligations</li>
              <li>Notifying you about changes to our services</li>
              <li>Improving our services and developing new features</li>
              <li>Providing customer support</li>
              <li>Marketing and promotional communications (with your consent)</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. Data Protection and Security</h2>
            <p className="mb-4">
              We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. Our security practices include:
            </p>
            <ul className="list-disc pl-5 mb-4">
              <li>Encryption of sensitive financial data</li>
              <li>Regular security assessments</li>
              <li>PCI DSS compliance</li>
              <li>Access controls for internal systems</li>
              <li>Employee training on data protection</li>
            </ul>
            <p>
              However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your personal information, we cannot guarantee its absolute security.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Disclosure of Information</h2>
            <p className="mb-4">
              We may disclose your personal information in the following circumstances:
            </p>
            <ul className="list-disc pl-5 mb-4">
              <li>To our subsidiaries and affiliates</li>
              <li>To contractors, service providers, and other third parties we use to support our business</li>
              <li>To comply with any court order, law, or legal process</li>
              <li>To enforce our Terms of Service</li>
              <li>If we believe disclosure is necessary to protect our rights, property, or safety, or that of our users or others</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Your Rights</h2>
            <p className="mb-4">
              Depending on your location, you may have certain rights regarding your personal information, including:
            </p>
            <ul className="list-disc pl-5 mb-4">
              <li>The right to access your personal information</li>
              <li>The right to correct inaccurate information</li>
              <li>The right to delete your personal information</li>
              <li>The right to restrict or object to processing</li>
              <li>The right to data portability</li>
              <li>The right to withdraw consent</li>
            </ul>
            <p>
              To exercise these rights, please contact us using the information provided in the "Contact Us" section.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Children's Privacy</h2>
            <p>
              Our services are not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">8. Changes to This Privacy Policy</h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes.
            </p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-4">9. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at privacy@bmaglasspay.com.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
