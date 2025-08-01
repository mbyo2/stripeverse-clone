
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Search, MessageCircle, Phone, Mail, ExternalLink, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Help = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const { toast } = useToast();

  const faqs = [
    {
      id: '1',
      question: 'How do I create a virtual card?',
      answer: 'To create a virtual card, go to your Wallet page and click on "Create Card" in the Virtual Cards section. Fill in the card details and set your initial balance. Your virtual card will be ready for use immediately.'
    },
    {
      id: '2',
      question: 'What are the transaction limits?',
      answer: 'Daily transaction limits vary by account type: Basic accounts have a K5,000 daily limit, Premium accounts have K20,000, and Business accounts have K100,000. Monthly limits are 10x the daily limits.'
    },
    {
      id: '3',
      question: 'How do I add money to my wallet?',
      answer: 'You can add money to your wallet using Mobile Money (MTN, Airtel, Zamtel), bank transfers, or debit/credit cards. Click "Add Money" on your wallet page and select your preferred payment method.'
    },
    {
      id: '4',
      question: 'Are international transactions supported?',
      answer: 'Yes, we support international transactions through our virtual cards. However, international transfers may have additional fees and require KYC verification.'
    },
    {
      id: '5',
      question: 'How secure are my transactions?',
      answer: 'All transactions are encrypted using bank-level security. We use 2FA, biometric authentication, and monitor for suspicious activity 24/7.'
    },
    {
      id: '6',
      question: 'What should I do if my virtual card is compromised?',
      answer: 'Immediately freeze your card from the wallet page, then contact our support team. You can also create a new virtual card to replace the compromised one.'
    }
  ];

  const quickActions = [
    {
      title: 'Reset Password',
      description: 'Change your account password',
      action: () => window.location.href = '/reset-password'
    },
    {
      title: 'Update Profile',
      description: 'Modify your personal information',
      action: () => window.location.href = '/profile'
    },
    {
      title: 'Transaction History',
      description: 'View all your transactions',
      action: () => window.location.href = '/transactions'
    },
    {
      title: 'KYC Verification',
      description: 'Complete identity verification',
      action: () => window.location.href = '/kyc'
    }
  ];

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Message Sent",
      description: "We've received your message and will get back to you within 24 hours.",
    });
    setContactForm({ name: '', email: '', subject: '', message: '' });
  };

  const filteredFaqs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-4">How can we help you?</h1>
          <p className="text-xl text-muted-foreground mb-6">
            Find answers to common questions or get in touch with our support team
          </p>
          
          <div className="max-w-md mx-auto relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
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
            <TabsTrigger value="contact">Contact Support</TabsTrigger>
            <TabsTrigger value="guides">Quick Actions</TabsTrigger>
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
                      <AccordionTrigger className="text-left">
                        {faq.question}
                      </AccordionTrigger>
                      <AccordionContent>
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                
                {filteredFaqs.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      No FAQ found matching your search. Try different keywords or contact support.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Name</label>
                          <Input
                            value={contactForm.name}
                            onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Email</label>
                          <Input
                            type="email"
                            value={contactForm.email}
                            onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Subject</label>
                        <Input
                          value={contactForm.subject}
                          onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Message</label>
                        <Textarea
                          value={contactForm.message}
                          onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                          rows={6}
                          required
                        />
                      </div>
                      
                      <Button type="submit" className="w-full">
                        Send Message
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Other ways to reach us</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <Phone className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Phone Support</p>
                        <p className="text-sm text-muted-foreground">+260 21 123 4567</p>
                        <p className="text-xs text-muted-foreground">Mon-Fri 8AM-6PM</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <Mail className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Email Support</p>
                        <p className="text-sm text-muted-foreground">support@bmaglass.com</p>
                        <p className="text-xs text-muted-foreground">Response within 24hrs</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <MessageCircle className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Live Chat</p>
                        <p className="text-sm text-muted-foreground">Available 24/7</p>
                        <Button variant="outline" size="sm" className="mt-1">
                          Start Chat
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Resources</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="ghost" className="w-full justify-between">
                      User Guide
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" className="w-full justify-between">
                      API Documentation
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" className="w-full justify-between">
                      Security Guide
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="guides">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {quickActions.map((action, index) => (
                <Card key={index} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium mb-1">{action.title}</h3>
                        <p className="text-sm text-muted-foreground">{action.description}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Help;
