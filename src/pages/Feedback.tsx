
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Feedback = () => {
  const [feedbackType, setFeedbackType] = useState<"bug" | "feature" | "general">("bug");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    try {
      // In a real app, you would send this data to your backend
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsSubmitted(true);
      toast({
        title: "Feedback submitted",
        description: "Thank you for helping us improve our platform!",
      });
    } catch (error) {
      toast({
        title: "Submission failed",
        description: "There was an error submitting your feedback. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 pt-24 pb-16">
        {!isSubmitted ? (
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Beta Feedback</CardTitle>
              <CardDescription>
                Your feedback helps us improve the platform. Thank you for participating in our beta program!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="feedback-type">Feedback Type</Label>
                  <div className="flex space-x-2">
                    <Button 
                      type="button"
                      variant={feedbackType === "bug" ? "default" : "outline"}
                      onClick={() => setFeedbackType("bug")}
                      className="flex-1"
                    >
                      Bug Report
                    </Button>
                    <Button 
                      type="button"
                      variant={feedbackType === "feature" ? "default" : "outline"}
                      onClick={() => setFeedbackType("feature")}
                      className="flex-1"
                    >
                      Feature Request
                    </Button>
                    <Button 
                      type="button"
                      variant={feedbackType === "general" ? "default" : "outline"}
                      onClick={() => setFeedbackType("general")}
                      className="flex-1"
                    >
                      General
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief description of your feedback"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Please provide as much detail as possible"
                    className="min-h-[150px]"
                    required
                  />
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "Submit Feedback"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center space-y-4">
                <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                
                <CardTitle>Thank You!</CardTitle>
                <CardDescription className="text-center">
                  Your feedback has been submitted successfully. We appreciate your contribution to making our product better.
                </CardDescription>
                
                <Button onClick={() => window.history.back()} className="mt-6">
                  Return to Previous Page
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Feedback;
