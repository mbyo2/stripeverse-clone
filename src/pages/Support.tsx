
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Phone, Mail, Search, Clock } from "lucide-react";

const Support = () => {
  const [tickets, setTickets] = useState([
    {
      id: "TKT-001",
      subject: "Payment processing issue",
      status: "open",
      priority: "high",
      created: "2024-01-20",
      lastUpdate: "2024-01-20"
    },
    {
      id: "TKT-002",
      subject: "API integration help",
      status: "resolved",
      priority: "medium",
      created: "2024-01-18",
      lastUpdate: "2024-01-19"
    }
  ]);

  const faqs = [
    {
      question: "How do I integrate with the payment API?",
      answer: "You can integrate with our API using the REST endpoints. Check our API documentation for detailed examples."
    },
    {
      question: "What payment methods are supported?",
      answer: "We support Mobile Money (MTN, Airtel, Zamtel), Card payments (Visa, Mastercard), and Bank transfers."
    },
    {
      question: "How long do transactions take to process?",
      answer: "Most transactions are processed instantly. Bank transfers may take 1-3 business days."
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Support Center</h1>
          <p className="text-muted-foreground">
            Get help with your account and technical issues
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
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
                <Mail className="h-5 w-5" />
                Email Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Send us an email for detailed support
              </p>
              <Button variant="outline" className="w-full">
                support@bmaglass.com
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Phone Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Call us during business hours
              </p>
              <Button variant="outline" className="w-full">
                +260 123 456 789
              </Button>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="tickets" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="tickets">My Tickets</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="new">New Ticket</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets">
            <Card>
              <CardHeader>
                <CardTitle>Support Tickets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{ticket.id}</span>
                          <Badge variant={ticket.status === 'open' ? 'destructive' : 'default'}>
                            {ticket.status}
                          </Badge>
                          <Badge variant={ticket.priority === 'high' ? 'destructive' : 'secondary'}>
                            {ticket.priority}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium">{ticket.subject}</p>
                        <p className="text-sm text-muted-foreground">
                          Created: {ticket.created} • Last update: {ticket.lastUpdate}
                        </p>
                      </div>
                      <Button variant="outline" size="sm">View</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="faq">
            <Card>
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
                <div className="flex gap-2">
                  <Search className="h-4 w-4 text-muted-foreground mt-3" />
                  <Input placeholder="Search FAQs..." />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {faqs.map((faq, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <h3 className="font-medium mb-2">{faq.question}</h3>
                      <p className="text-sm text-muted-foreground">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle>Create New Ticket</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Subject</label>
                    <Input placeholder="Brief description of your issue" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Priority</label>
                    <select className="w-full p-2 border rounded">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea placeholder="Please provide detailed information about your issue..." rows={6} />
                  </div>
                  <Button className="w-full">Submit Ticket</Button>
                </div>
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
