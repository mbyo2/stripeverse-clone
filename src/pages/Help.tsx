
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Search, MessageCircle, Phone, Mail, ExternalLink, ChevronRight, BookOpen, Shield, CreditCard, Smartphone, Users, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Link } from 'react-router-dom';

const Help = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const { toast } = useToast();

  const faqs = [
    { id: '1', question: 'How do I create a virtual card?', answer: 'Go to your Wallet page and click "Create Card" in the Virtual Cards section. Choose a name, set your initial balance, and your card is ready instantly for online purchases.' },
    { id: '2', question: 'What are the transaction limits?', answer: 'Limits depend on your tier: Free – K5,000/day, Starter – K20,000/day, Professional – K100,000/day, Enterprise – Custom. Monthly limits are 10× daily. Upgrade in Pricing.' },
    { id: '3', question: 'How do I add money to my wallet?', answer: 'Click "Add Money" on your Wallet page. Choose Mobile Money (MTN, Airtel, Zamtel), bank transfer, or card. Mobile Money deposits are instant; bank transfers take 1-3 business days.' },
    { id: '4', question: 'Are international transactions supported?', answer: 'Yes, through virtual cards and Bitcoin. International transfers may carry additional fees and require completed KYC verification.' },
    { id: '5', question: 'How secure are my transactions?', answer: 'We use bank-level AES-256 encryption, PCI DSS compliance, two-factor authentication, and 24/7 fraud monitoring. All card data is encrypted at rest.' },
    { id: '6', question: 'What should I do if my virtual card is compromised?', answer: 'Immediately freeze the card from your Wallet page, then contact support. You can create a replacement card instantly.' },
    { id: '7', question: 'How do I complete KYC verification?', answer: 'Navigate to Settings → KYC or go to /kyc directly. Upload your government ID (front & back), a selfie, and proof of address. Verification completes within 24 hours.' },
    { id: '8', question: 'How do refunds and disputes work?', answer: 'Go to Transactions, find the transaction, and click "Dispute". Provide details and any evidence. Our team reviews within 3-5 business days and you\'ll receive a notification with the outcome.' },
    { id: '9', question: 'Can I use BMaGlass Pay for my business?', answer: 'Yes! Apply for a Business account through Role Management. You\'ll get access to the merchant dashboard, API keys, webhook management, and settlement tools.' },
    { id: '10', question: 'What mobile money providers do you support?', answer: 'We support MTN Mobile Money, Airtel Money, and Zamtel Money for deposits, withdrawals, and peer-to-peer transfers.' },
  ];

  const guides = [
    { title: 'Getting Started', description: 'Create your account and make your first transaction', icon: BookOpen, link: '/dashboard' },
    { title: 'KYC Verification', description: 'Complete identity verification to unlock full features', icon: Users, link: '/kyc' },
    { title: 'Virtual Cards', description: 'Create and manage virtual cards for online payments', icon: CreditCard, link: '/wallet' },
    { title: 'Mobile Money', description: 'Set up mobile money deposits and withdrawals', icon: Smartphone, link: '/payment-services' },
    { title: 'Security Settings', description: 'Enable 2FA and review your security dashboard', icon: Shield, link: '/security-settings' },
    { title: 'Business API', description: 'Integrate payments into your website or app', icon: ExternalLink, link: '/api' },
  ];

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('contact_messages').insert({
        name: contactForm.name,
        email: contactForm.email,
        subject: contactForm.subject,
        message: contactForm.message,
      });
      if (error) throw error;
      toast({ title: "Message Sent", description: "We'll get back to you within 24 hours." });
      setContactForm({ name: '', email: '', subject: '', message: '' });
    } catch (error: any) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredFaqs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-4">How can we help you?</h1>
          <p className="text-xl text-muted-foreground mb-6">
            Find answers, read guides, or contact our support team
          </p>
          <div className="max-w-md mx-auto relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search for help..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 py-3 text-lg"
            />
          </div>
        </div>

        <Tabs defaultValue="faq" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="guides">Guides</TabsTrigger>
            <TabsTrigger value="contact">Contact Support</TabsTrigger>
          </TabsList>

          <TabsContent value="faq">
            <Card>
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {filteredFaqs.map((faq) => (
                    <AccordionItem key={faq.id} value={faq.id}>
                      <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                {filteredFaqs.length === 0 && (
                  <p className="text-center py-8 text-muted-foreground">No results. Try different keywords or contact support.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guides">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {guides.map((guide, index) => (
                <Link to={guide.link} key={index}>
                  <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <guide.icon className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium mb-1">{guide.title}</h3>
                          <p className="text-sm text-muted-foreground">{guide.description}</p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="contact">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Send us a message</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Name</label>
                          <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} required />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Email</label>
                          <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} required />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Subject</label>
                        <Input value={contactForm.subject} onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Message</label>
                        <Textarea value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} rows={6} required />
                      </div>
                      <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send Message"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle>Reach us directly</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <Phone className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Phone</p>
                        <p className="text-sm text-muted-foreground">+260 976 123 456</p>
                        <p className="text-xs text-muted-foreground">Mon-Fri 8AM-6PM CAT</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Mail className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Email</p>
                        <p className="text-sm text-muted-foreground">support@bmaglasspay.com</p>
                        <p className="text-xs text-muted-foreground">Response within 24hrs</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <MessageCircle className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Live Chat</p>
                        <p className="text-sm text-muted-foreground">Available 24/7</p>
                        <Button variant="outline" size="sm" className="mt-1">Start Chat</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Help;
