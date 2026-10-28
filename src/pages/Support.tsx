import { toUserFacingError } from "@/utils/userFacingError";

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
import { MessageCircle, Mail, Search, Clock, Loader2, Send, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const Support = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("faq");
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketForm, setTicketForm] = useState({
    name: '',
    email: '',
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
      answer: "Today you can pay with Bitcoin, or with PayPal in US dollars. Mobile Money (MTN, Airtel, Zamtel) is coming soon through direct connections to each provider — it is not live yet. Card payments and USSD are not live yet either."
    },
    {
      question: "How long do transactions take to process?",
      answer: "Bitcoin deposits are credited after network confirmation. PayPal deposits are credited once PayPal confirms the payment. Timings for bank and mobile-money transfers will be published when those connections launch."
    },
    {
      question: "How do I verify my identity (KYC)?",
      answer: "Go to Settings → KYC Verification, or navigate directly to /kyc. You'll need a valid government ID (front and back, uploaded as files), a selfie captured live with your camera inside the wizard — file uploads are not accepted for your face — and proof of address. Verification typically completes within 24 hours."
    },
    {
      question: "What are the transaction limits?",
      answer: "Limits depend on your verification (KYC) status — completing verification raises your limits. BMaGlass Pay has no subscription tiers or paid plans: everyone uses the same account, and you only pay the percentage fee on each transaction."
    },
    {
      question: "How do I freeze or cancel a virtual card?",
      answer: "Virtual cards are coming soon — there are no live cards to freeze yet. When they launch, you will freeze or cancel a card from your Wallet page; frozen cards can be reactivated and cancelled cards are permanent."
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
    // Logged-out visitors type their own contact details (the fields
    // render only for them); signed-in users are identified from their
    // account, as before.
    if (!user && (!ticketForm.name.trim() || !ticketForm.email.trim())) {
      toast({ title: "Missing fields", description: "Please add your name and email so we can reply to you.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('contact_messages').insert({
        name: user ? (user.user_metadata?.first_name || user.email || 'User') : ticketForm.name.trim(),
        email: user ? (user.email || '') : ticketForm.email.trim(),
        subject: `[${ticketForm.priority.toUpperCase()}] ${ticketForm.subject}`,
        message: ticketForm.message,
      });

      if (error) throw error;

      toast({ title: "Ticket Submitted", description: "We'll get back to you within 24 hours." });
      setTicketForm({ name: '', email: '', subject: '', priority: 'medium', message: '' });
    } catch (error: any) {
      toast({ title: "Submission Failed", description: toUserFacingError(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
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
                Support Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Send a message to our support team — we reply by email
              </p>
              <Button className="w-full" onClick={() => setActiveTab("new")}>Contact Support</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Contact Form
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                No account needed — send a message through our contact page
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/contact">Send a Message</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Help Centre
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Guides and answers to common questions
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/help">Visit the Help Centre</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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
                {!user && (
                  <>
                    <div className="space-y-2">
                      <Label>Your Name</Label>
                      <Input
                        placeholder="Your full name"
                        value={ticketForm.name}
                        onChange={(e) => setTicketForm({ ...ticketForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Your Email</Label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={ticketForm.email}
                        onChange={(e) => setTicketForm({ ...ticketForm, email: e.target.value })}
                      />
                    </div>
                  </>
                )}
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
