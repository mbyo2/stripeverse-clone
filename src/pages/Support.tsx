
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MessageCircle, Phone, Mail, Search, Clock, Loader2, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const Support = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketForm, setTicketForm] = useState({
    subject: '',
    priority: 'medium',
    message: '',
  });

  const faqs = [
    {
      question: "How do I integrate with the payment API?",
      answer: "You can integrate with our API using the REST endpoints. Navigate to the API Documentation section in your business dashboard for detailed examples, SDKs, and sandbox testing tools."
    },
    {
      question: "What payment methods are supported?",
      answer: "We support Mobile Money (MTN, Airtel, Zamtel), Card payments (Visa, Mastercard), Bank transfers, USSD payments, and Bitcoin."
    },
    {
      question: "How long do transactions take to process?",
      answer: "Mobile Money transactions are processed instantly. Card payments settle within minutes. Bank transfers may take 1-3 business days depending on your bank."
    },
    {
      question: "How do I verify my identity (KYC)?",
      answer: "Go to Settings → KYC Verification, or navigate directly to /kyc. You'll need a valid government ID (front and back), a selfie, and proof of address. Verification typically completes within 24 hours."
    },
    {
      question: "What are the transaction limits?",
      answer: "Limits depend on your subscription tier. Free accounts: K5,000/day. Starter: K20,000/day. Professional: K100,000/day. Enterprise: Custom limits. Upgrade your tier in Pricing."
    },
    {
      question: "How do I freeze or cancel a virtual card?",
      answer: "Open your Wallet, find the card under Virtual Cards, click on it, and use the Freeze or Cancel button. Frozen cards can be reactivated; cancelled cards are permanent."
    },
    {
      question: "Can I get a refund for a failed transaction?",
      answer: "Yes. Go to Transactions, find the transaction, and click 'Dispute'. Provide details and evidence. Our team reviews disputes within 3-5 business days."
    },
    {
      question: "How do I set up two-factor authentication?",
      answer: "Go to Settings → Security → Two-Factor Authentication. You'll scan a QR code with an authenticator app (Google Authenticator, Authy) and enter a verification code to complete setup."
    },
  ];

  const filteredFaqs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmitTicket = async () => {
    if (!ticketForm.subject || !ticketForm.message) {
      toast({ title: "Missing fields", description: "Please fill in subject and description.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('contact_messages').insert({
        name: user?.user_metadata?.first_name || user?.email || 'User',
        email: user?.email || '',
        subject: `[${ticketForm.priority.toUpperCase()}] ${ticketForm.subject}`,
        message: ticketForm.message,
      });

      if (error) throw error;

      toast({ title: "Ticket Submitted", description: "We'll get back to you within 24 hours." });
      setTicketForm({ subject: '', priority: 'medium', message: '' });
    } catch (error: any) {
      toast({ title: "Submission Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Support Center</h1>
          <p className="text-muted-foreground">
            Get help with your account, payments, and technical issues
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                Live Chat
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Chat with our support team in real-time
              </p>
              <Button className="w-full">Start Chat</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Email Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Send us an email for detailed support
              </p>
              <Button variant="outline" className="w-full" asChild>
                <a href="mailto:support@bmaglasspay.com">support@bmaglasspay.com</a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                Phone Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-2">
                Mon-Fri 8:00 AM – 6:00 PM CAT
              </p>
              <Button variant="outline" className="w-full" asChild>
                <a href="tel:+260976123456">+260 976 123 456</a>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="faq" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="new">Submit a Ticket</TabsTrigger>
          </TabsList>

          <TabsContent value="faq">
            <Card>
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search FAQs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {filteredFaqs.map((faq, index) => (
                    <AccordionItem key={index} value={`faq-${index}`}>
                      <AccordionTrigger className="text-left">
                        {faq.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                {filteredFaqs.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No results found. Try different keywords or submit a ticket.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle>Create Support Ticket</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input
                    placeholder="Brief description of your issue"
                    value={ticketForm.subject}
                    onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={ticketForm.priority}
                    onValueChange={(value) => setTicketForm({ ...ticketForm, priority: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    placeholder="Please describe your issue in detail..."
                    rows={6}
                    value={ticketForm.message}
                    onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                  />
                </div>
                <Button className="w-full" onClick={handleSubmitTicket} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
                  ) : (
                    <><Send className="mr-2 h-4 w-4" /> Submit Ticket</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Support;
