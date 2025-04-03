
import React from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const Faq = () => {
  const generalFaqs = [
    {
      question: "What is BMaGlass Pay?",
      answer: "BMaGlass Pay is a comprehensive payment solution that enables businesses and individuals to send, receive, and manage payments securely. Our platform is PCI DSS compliant and approved by the Bank of Zambia, offering mobile money integration, card processing, USSD payments, and more."
    },
    {
      question: "How do I create an account?",
      answer: "To create an account, click on the 'Sign Up' button on the homepage. Fill in your details including name, email, and phone number. You'll receive a verification link to confirm your email address."
    },
    {
      question: "Is my money safe with BMaGlass Pay?",
      answer: "Yes, your money is secure with BMaGlass Pay. We implement industry-standard security measures including encryption, PCI DSS compliance, and regular security audits. Additionally, we're officially approved by the Bank of Zambia."
    },
    {
      question: "What are the transaction fees?",
      answer: "Our transaction fees vary depending on the payment method and transaction volume. Generally, mobile money transactions have a fee of 1-2%, card payments 2.5-3%, and USSD payments 1.5%. Volume discounts are available for businesses with high transaction volumes."
    }
  ];

  const businessFaqs = [
    {
      question: "How can I integrate BMaGlass Pay into my business?",
      answer: "You can integrate BMaGlass Pay through our API, which supports various payment methods. We provide comprehensive documentation, SDKs for popular programming languages, and dedicated technical support to assist with your integration."
    },
    {
      question: "What reporting features are available for businesses?",
      answer: "Our business dashboard offers detailed reporting features including transaction history, settlement reports, revenue analytics, customer insights, and customizable export options. You can also set up automated reports to be delivered to your email."
    },
    {
      question: "How long does settlement take?",
      answer: "Standard settlements are processed within 24-48 hours. Business accounts with high volumes may qualify for faster settlement options, with same-day settlement available for eligible merchants."
    },
    {
      question: "Do you provide integration support?",
      answer: "Yes, we provide comprehensive integration support through our documentation, developer community, and dedicated technical support team. Enterprise clients receive personalized integration assistance from our solutions engineers."
    }
  ];

  const paymentFaqs = [
    {
      question: "Which payment methods are supported?",
      answer: "We support a wide range of payment methods including Visa, Mastercard, mobile money services (MTN, Airtel, Zamtel), USSD payments, bank transfers, and Bitcoin."
    },
    {
      question: "Are international payments supported?",
      answer: "Yes, we support international payments through card processing and Bitcoin. International transactions may be subject to additional verification for security purposes."
    },
    {
      question: "How secure are the transactions?",
      answer: "All transactions are secured with industry-standard encryption and comply with PCI DSS standards. We implement multi-factor authentication, tokenization, and real-time fraud detection systems."
    },
    {
      question: "What happens if a payment fails?",
      answer: "If a payment fails, you'll receive an immediate notification with details about the failure reason. You can retry the payment or choose an alternative payment method. Our system provides clear error messages and resolution guidance."
    }
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">Frequently Asked Questions</h1>
          <p className="text-muted-foreground mb-8">
            Find answers to the most common questions about our payment services.
          </p>
          
          <div className="relative max-w-md mb-10">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search FAQs..."
              className="pl-10"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {generalFaqs.map((faq, index) => (
                  <AccordionItem key={`general-${index}`} value={`general-${index}`}>
                    <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                    <AccordionContent>{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Business & Merchants</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {businessFaqs.map((faq, index) => (
                  <AccordionItem key={`business-${index}`} value={`business-${index}`}>
                    <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                    <AccordionContent>{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {paymentFaqs.map((faq, index) => (
                  <AccordionItem key={`payment-${index}`} value={`payment-${index}`}>
                    <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                    <AccordionContent>{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>
        
        <div className="bg-secondary/20 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Still have questions?</h2>
          <p className="mb-6 max-w-xl mx-auto">
            If you couldn't find the answer to your question, please reach out to our support team.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href="/contact" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Contact Support
            </a>
            <a href="mailto:support@bmaglasspay.com" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
              Email Us
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Faq;
