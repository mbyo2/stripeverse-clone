
import React, { useState, useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle, Bug, Lightbulb, MessageSquare, Monitor, Smartphone, Laptop } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Define schema for form validation
const feedbackSchema = z.object({
  feedbackType: z.enum(["bug", "feature", "general"]),
  subject: z.string().min(3, "Subject must be at least 3 characters"),
  description: z.string().min(10, "Please provide a more detailed description"),
  email: z.string().email("Please enter a valid email").optional().or(z.literal("")),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  browser: z.string().optional(),
  device: z.string().optional(),
  screenshot: z.instanceof(FileList).optional().refine(
    (files) => !files || files.length === 0 || Array.from(files).every(file => file.type.startsWith("image/")),
    "Please upload only image files"
  ),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

const Feedback = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [browserInfo, setBrowserInfo] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [betaVersion, setBetaVersion] = useState("0.9.0");
  const { toast } = useToast();

  // Get browser, device information and beta version
  useEffect(() => {
    setBrowserInfo(navigator.userAgent);
    
    // Determine device type
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      setDeviceType("tablet");
    } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
      setDeviceType("mobile");
    } else {
      setDeviceType("desktop");
    }
    
    // Get beta version from localStorage if available
    try {
      const dismissedData = localStorage.getItem("betaBannerDismissed");
      if (dismissedData) {
        const { version } = JSON.parse(dismissedData);
        if (version) {
          setBetaVersion(version);
        }
      }
    } catch (error) {
      console.error("Error parsing beta version:", error);
    }
  }, []);

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      feedbackType: "bug",
      subject: "",
      description: "",
      email: "",
      severity: "medium",
      browser: browserInfo,
      device: deviceType,
    },
  });

  // Update form values when browser and device info are available
  useEffect(() => {
    form.setValue("browser", browserInfo);
    form.setValue("device", deviceType);
  }, [browserInfo, deviceType, form]);

  const getDeviceIcon = () => {
    switch (deviceType) {
      case "mobile":
        return <Smartphone className="h-5 w-5" />;
      case "tablet":
        return <Tablet className="h-5 w-5" />;
      default:
        return <Laptop className="h-5 w-5" />;
    }
  };

  const getFeedbackTypeIcon = (type: string) => {
    switch (type) {
      case "bug":
        return <Bug className="h-5 w-5" />;
      case "feature":
        return <Lightbulb className="h-5 w-5" />;
      default:
        return <MessageSquare className="h-5 w-5" />;
    }
  };

  const onSubmit = async (data: FeedbackFormValues) => {
    setIsSubmitting(true);
    
    // Add version information to the submission
    const feedbackData = {
      ...data,
      betaVersion,
      submittedAt: new Date().toISOString(),
    };
    
    // Simulate API call
    try {
      // In a real app, you would send this data to your backend
      console.log("Submitting feedback:", feedbackData);
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
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Beta Feedback (v{betaVersion})
              </CardTitle>
              <CardDescription>
                Your feedback helps us improve the platform. Thank you for participating in our beta program!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <Alert className="bg-amber-50 border-amber-200 mb-4">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <AlertTitle>Beta Information</AlertTitle>
                    <AlertDescription className="text-xs">
                      You're currently testing version {betaVersion}. Your device and browser information will be automatically included with your feedback to help us troubleshoot issues.
                    </AlertDescription>
                  </Alert>
                  
                  <FormField
                    control={form.control}
                    name="feedbackType"
                    render={({ field }) => (
                      <FormItem className="space-y-2">
                        <FormLabel>Feedback Type</FormLabel>
                        <div className="flex flex-wrap gap-2">
                          <Button 
                            type="button"
                            variant={field.value === "bug" ? "default" : "outline"}
                            onClick={() => form.setValue("feedbackType", "bug")}
                            className="flex-1 gap-2"
                          >
                            <Bug className="h-4 w-4" />
                            Bug Report
                          </Button>
                          <Button 
                            type="button"
                            variant={field.value === "feature" ? "default" : "outline"}
                            onClick={() => form.setValue("feedbackType", "feature")}
                            className="flex-1 gap-2"
                          >
                            <Lightbulb className="h-4 w-4" />
                            Feature Request
                          </Button>
                          <Button 
                            type="button"
                            variant={field.value === "general" ? "default" : "outline"}
                            onClick={() => form.setValue("feedbackType", "general")}
                            className="flex-1 gap-2"
                          >
                            <MessageSquare className="h-4 w-4" />
                            General
                          </Button>
                        </div>
                      </FormItem>
                    )}
                  />
                  
                  {form.watch("feedbackType") === "bug" && (
                    <FormField
                      control={form.control}
                      name="severity"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Severity</FormLabel>
                          <div className="flex flex-wrap gap-2">
                            <Button 
                              type="button"
                              variant={field.value === "low" ? "default" : "outline"}
                              onClick={() => form.setValue("severity", "low")}
                              className="flex-1"
                            >
                              Low
                            </Button>
                            <Button 
                              type="button"
                              variant={field.value === "medium" ? "default" : "outline"}
                              onClick={() => form.setValue("severity", "medium")}
                              className="flex-1"
                            >
                              Medium
                            </Button>
                            <Button 
                              type="button"
                              variant={field.value === "high" ? "default" : "outline"}
                              onClick={() => form.setValue("severity", "high")}
                              className="flex-1"
                            >
                              High
                            </Button>
                            <Button 
                              type="button"
                              variant={field.value === "critical" ? "default" : "outline"}
                              onClick={() => form.setValue("severity", "critical")}
                              className="flex-1"
                            >
                              Critical
                            </Button>
                          </div>
                        </FormItem>
                      )}
                    />
                  )}
                  
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Brief description of your feedback"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Please provide as much detail as possible"
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="screenshot"
                    render={({ field: { value, onChange, ...fieldProps } }) => (
                      <FormItem>
                        <FormLabel>Screenshot (optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => onChange(e.target.files)}
                            className="cursor-pointer"
                            {...fieldProps}
                          />
                        </FormControl>
                        <FormDescription>
                          Upload a screenshot if it helps explain the issue.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email (optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="Your email if you'd like us to follow up"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          We'll only use this to follow up on your feedback if needed.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="pt-2">
                    <FormDescription className="flex items-center gap-2 mb-2">
                      {getDeviceIcon()}
                      <span>
                        Automatically detected: {deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}
                      </span>
                    </FormDescription>
                  </div>
                  
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Submitting..." : "Submit Feedback"}
                  </Button>
                </form>
              </Form>
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
                
                <div className="mt-2 text-xs text-gray-500">
                  Beta version: {betaVersion}
                </div>
                
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
