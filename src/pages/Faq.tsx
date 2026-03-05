
import React, { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Faq = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const categories = [
    {
      title: "General",
      faqs: [
        { question: "What is BMaGlass Pay?", answer: "BMaGlass Pay is a comprehensive payment solution enabling businesses and individuals to send, receive, and manage payments securely. We're PCI DSS compliant and approved by the Bank of Zambia, offering mobile money, card processing, USSD payments, virtual cards, and Bitcoin." },
        { question: "How do I create an account?", answer: "Click 'Sign Up' on the homepage. Enter your name, email, and phone number. Verify your email, then complete KYC verification to unlock all features." },
        { question: "Is my money safe with BMaGlass Pay?", answer: "Yes. We use AES-256 encryption, PCI DSS compliance, two-factor authentication, and 24/7 fraud monitoring. We're officially licensed by the Bank of Zambia." },
        { question: "What are the transaction fees?", answer: "Mobile Money: 1-2%, Card payments: 2.5-3%, USSD: 1.5%, Bank transfers: K5 flat fee. Volume discounts available for Business accounts. See our Pricing page for details." },
      ]
    },
    {
      title: "Business & Merchants",
      faqs: [
        { question: "How can I integrate BMaGlass Pay into my business?", answer: "Apply for a Business role, then access the API documentation from your Business Dashboard. We provide REST APIs, SDKs, webhook support, and a sandbox environment for testing." },
        { question: "What reporting features are available?", answer: "Transaction history, revenue analytics, payment method breakdowns, settlement reports, and customisable CSV exports. Real-time dashboards update automatically." },
        { question: "How long does settlement take?", answer: "Standard: 24-48 hours. Business accounts with high volumes qualify for same-day settlement. Configure settlement frequency (daily/weekly/monthly) in Business Settings." },
        { question: "Do you provide integration support?", answer: "Yes — documentation, developer community, and dedicated technical support. Enterprise clients receive personalised integration assistance from our solutions engineers." },
      ]
    },
    {
      title: "Payments & Cards",
      faqs: [
        { question: "Which payment methods are supported?", answer: "Visa, Mastercard, Mobile Money (MTN, Airtel, Zamtel), USSD, bank transfers, and Bitcoin." },
        { question: "Are international payments supported?", answer: "Yes, through virtual cards and Bitcoin. International transactions may require additional KYC verification." },
        { question: "How do virtual cards work?", answer: "Create a virtual card from your Wallet, load funds, and use it for online purchases anywhere Visa/Mastercard is accepted. Cards can be frozen or cancelled instantly." },
        { question: "What happens if a payment fails?", answer: "You'll receive an instant notification with the failure reason. Retry or choose a different payment method. Failed transactions are never charged." },
      ]
    },
    {
      title: "Security & Account",
      faqs: [
        { question: "How do I enable two-factor authentication?", answer: "Go to Settings → Security → Two-Factor Authentication. Scan the QR code with an authenticator app and enter the verification code." },
        { question: "How do I reset my password?", answer: "Click 'Forgot Password' on the login page, enter your email, and follow the reset link sent to your inbox." },
        { question: "How do I complete KYC verification?", answer: "Navigate to /kyc or Settings → KYC. Upload government ID (front & back), a selfie, and proof of address. Verification completes within 24 hours." },
        { question: "Can I delete my account?", answer: "Contact support to request account deletion. All personal data will be removed within 30 days, subject to regulatory data retention requirements." },
      ]
    }
  ];

  const allFaqs = categories.flatMap(cat => cat.faqs.map(faq => ({ ...faq, category: cat.title })));
  const filtered = searchTerm
    ? allFaqs.filter(faq => faq.question.toLowerCase().includes(searchTerm.toLowerCase()) || faq.answer.toLowerCase().includes(searchTerm.toLowerCase()))
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-5xl mx-auto w-full">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-4">Frequently Asked Questions</h1>
          <p className="text-muted-foreground mb-8">
            Find answers to common questions about BMaGlass Pay
          </p>
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input placeholder="Search FAQs..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>

        {filtered ? (
          <Card className="mb-8">
            <CardHeader><CardTitle>Search Results ({filtered.length})</CardTitle></CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                {filtered.map((faq, i) => (
                  <AccordionItem key={i} value={`search-${i}`}>
                    <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {filtered.length === 0 && <p className="text-center text-muted-foreground py-6">No results found.</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            {categories.map((cat) => (
              <Card key={cat.title}>
                <CardHeader><CardTitle>{cat.title}</CardTitle></CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    {cat.faqs.map((faq, i) => (
                      <AccordionItem key={i} value={`${cat.title}-${i}`}>
                        <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                        <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="bg-muted/50 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Still have questions?</h2>
          <p className="mb-6 text-muted-foreground max-w-xl mx-auto">
            Our support team is ready to help you with any questions not covered here.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button asChild><Link to="/support">Contact Support</Link></Button>
            <Button variant="outline" asChild><a href="mailto:support@bmaglasspay.com">Email Us</a></Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Faq;
