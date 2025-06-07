
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { TestTube, Bug, Star, Lightbulb, AlertCircle, CheckCircle } from "lucide-react";

const BetaTesterDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    type: 'bug',
    title: '',
    description: '',
    severity: 'medium'
  });

  const handleFeedbackSubmit = async () => {
    if (!feedbackForm.title || !feedbackForm.description) {
      toast({
        title: "Incomplete Form",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('beta_feedback')
        .insert({
          type: feedbackForm.type,
          title: feedbackForm.title,
          description: feedbackForm.description,
          severity: feedbackForm.severity,
          email: user?.email,
          app_version: '1.0.0-beta',
          device_info: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language
          }
        });

      if (error) throw error;

      toast({
        title: "Feedback Submitted",
        description: "Thank you for your feedback! It helps us improve the app.",
      });

      setFeedbackForm({
        type: 'bug',
        title: '',
        description: '',
        severity: 'medium'
      });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast({
        title: "Submission Failed",
        description: "Failed to submit feedback. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const betaFeatures = [
    {
      name: "Enhanced Analytics",
      status: "testing",
      description: "Advanced transaction analytics and insights",
      link: "/transactions"
    },
    {
      name: "International Transfers",
      status: "coming_soon",
      description: "Send money globally with competitive rates",
      link: "/transfer"
    },
    {
      name: "Business API v2",
      status: "testing",
      description: "Next generation business integration tools",
      link: "/business"
    },
    {
      name: "Mobile App",
      status: "development",
      description: "Native mobile applications for iOS and Android",
      link: "#"
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'testing':
        return <Badge className="bg-blue-500">Testing</Badge>;
      case 'coming_soon':
        return <Badge className="bg-orange-500">Coming Soon</Badge>;
      case 'development':
        return <Badge className="bg-purple-500">In Development</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'testing':
        return <TestTube className="h-4 w-4" />;
      case 'coming_soon':
        return <AlertCircle className="h-4 w-4" />;
      case 'development':
        return <Lightbulb className="h-4 w-4" />;
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 to-orange-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <TestTube className="h-8 w-8 text-amber-600" />
            <h1 className="text-3xl font-bold">Beta Tester Dashboard</h1>
          </div>
          <p className="text-muted-foreground">Early access to new features and feedback tools</p>
        </div>

        <Tabs defaultValue="features" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="features">Beta Features</TabsTrigger>
            <TabsTrigger value="feedback">Submit Feedback</TabsTrigger>
            <TabsTrigger value="testing">Testing Guide</TabsTrigger>
          </TabsList>

          <TabsContent value="features">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {betaFeatures.map((feature) => (
                <Card key={feature.name}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        {getStatusIcon(feature.status)}
                        {feature.name}
                      </CardTitle>
                      {getStatusBadge(feature.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">{feature.description}</p>
                    {feature.status === 'testing' && feature.link !== '#' ? (
                      <Link to={feature.link}>
                        <Button variant="outline" className="w-full">
                          Test Feature
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="outline" disabled className="w-full">
                        {feature.status === 'coming_soon' ? 'Coming Soon' : 'Not Available'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="feedback">
            <Card>
              <CardHeader>
                <CardTitle>Submit Feedback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="type">Feedback Type</Label>
                    <Select value={feedbackForm.type} onValueChange={(value) => setFeedbackForm({...feedbackForm, type: value})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bug">🐛 Bug Report</SelectItem>
                        <SelectItem value="feature">💡 Feature Request</SelectItem>
                        <SelectItem value="improvement">⭐ Improvement</SelectItem>
                        <SelectItem value="general">💬 General Feedback</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="severity">Severity</Label>
                    <Select value={feedbackForm.severity} onValueChange={(value) => setFeedbackForm({...feedbackForm, severity: value})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    placeholder="Brief description of the issue or suggestion"
                    value={feedbackForm.title}
                    onChange={(e) => setFeedbackForm({...feedbackForm, title: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Detailed description of the issue, steps to reproduce, or your suggestion"
                    rows={6}
                    value={feedbackForm.description}
                    onChange={(e) => setFeedbackForm({...feedbackForm, description: e.target.value})}
                  />
                </div>

                <Button onClick={handleFeedbackSubmit} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? "Submitting..." : "Submit Feedback"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="testing">
            <Card>
              <CardHeader>
                <CardTitle>Beta Testing Guide</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">How to Test Effectively</h3>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Try different workflows and edge cases</li>
                    <li>Test on different devices and browsers</li>
                    <li>Pay attention to performance and loading times</li>
                    <li>Note any confusing or unintuitive user experiences</li>
                    <li>Report both bugs and suggestions for improvement</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Current Testing Priorities</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span>Virtual card creation and funding</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span>Money transfer functionality</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span>Mobile responsiveness</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span>User onboarding flow</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Feedback Guidelines</h3>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Be specific about steps to reproduce issues</li>
                    <li>Include your browser and device information</li>
                    <li>Attach screenshots when helpful</li>
                    <li>Suggest solutions when possible</li>
                    <li>Rate the severity appropriately</li>
                  </ul>
                </div>

                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    <h4 className="font-semibold text-amber-800">Beta Tester Rewards</h4>
                  </div>
                  <p className="text-amber-700 text-sm">
                    Active beta testers who provide valuable feedback will receive early access to premium features 
                    and may be eligible for account upgrades when the app launches publicly.
                  </p>
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

export default BetaTesterDashboard;
