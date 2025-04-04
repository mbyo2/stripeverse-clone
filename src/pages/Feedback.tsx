
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, BugIcon, Lightbulb, MessageCircle } from "lucide-react";
import { getDeviceInfo } from "@/utils/deviceDetection";

type FeedbackType = "bug" | "feature" | "general";
type FeedbackSeverity = "low" | "medium" | "high" | "critical";

const Feedback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("medium");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  
  // Initialize with current app version from localStorage or default to 0.9.0
  const [version] = useState(() => {
    const dismissedData = localStorage.getItem("betaBannerDismissed");
    if (dismissedData) {
      try {
        const { version } = JSON.parse(dismissedData);
        return version || "0.9.0";
      } catch {
        return "0.9.0";
      }
    }
    return "0.9.0";
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !description.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide both a title and description for your feedback.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    // Get device info
    const deviceInfo = getDeviceInfo();
    
    // In a real app, you would send this data to your backend
    const feedbackData = {
      type: feedbackType,
      title,
      description,
      email: email || "Anonymous",
      severity: feedbackType === "bug" ? severity : undefined,
      screenshot: screenshot ? "Attached" : "None",
      appVersion: version,
      deviceInfo,
      timestamp: new Date().toISOString(),
    };
    
    console.log("Feedback data:", feedbackData);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      
      toast({
        title: "Feedback Received",
        description: "Thank you for helping us improve the platform!",
      });
    }, 1500);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Basic validation (file type and size)
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File",
          description: "Please upload an image file.",
          variant: "destructive",
        });
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: "File Too Large",
          description: "Please upload an image smaller than 5MB.",
          variant: "destructive",
        });
        return;
      }
      
      setScreenshot(file);
    }
  };
  
  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  const getFeedbackIcon = () => {
    switch (feedbackType) {
      case "bug": return <BugIcon className="h-5 w-5" />;
      case "feature": return <Lightbulb className="h-5 w-5" />;
      case "general": return <MessageCircle className="h-5 w-5" />;
      default: return null;
    }
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="flex items-center space-x-2 mb-6">
          <div className="bg-amber-500 text-black px-2 py-1 rounded text-xs font-medium">BETA v{version}</div>
          <h1 className="text-3xl font-bold">Beta Feedback</h1>
        </div>
        
        {!isSubmitted ? (
          <Card>
            <CardHeader>
              <CardTitle>Submit Your Feedback</CardTitle>
              <CardDescription>
                Help us improve by sharing your experience, reporting bugs, or suggesting new features.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-base">Feedback Type</Label>
                    <RadioGroup
                      defaultValue="bug"
                      value={feedbackType}
                      onValueChange={(value) => setFeedbackType(value as FeedbackType)}
                      className="flex flex-col sm:flex-row mt-2 space-y-1 sm:space-y-0 sm:space-x-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="bug" id="bug" />
                        <Label htmlFor="bug" className="flex items-center">
                          <BugIcon className="mr-1 h-4 w-4" /> Bug Report
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="feature" id="feature" />
                        <Label htmlFor="feature" className="flex items-center">
                          <Lightbulb className="mr-1 h-4 w-4" /> Feature Request
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="general" id="general" />
                        <Label htmlFor="general" className="flex items-center">
                          <MessageCircle className="mr-1 h-4 w-4" /> General Feedback
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      placeholder="Brief summary of your feedback"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Please provide as much detail as possible"
                      className="min-h-[150px]"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      required
                    />
                  </div>
                  
                  {feedbackType === "bug" && (
                    <div className="space-y-2">
                      <Label htmlFor="severity">Severity</Label>
                      <Select
                        value={severity}
                        onValueChange={(value) => setSeverity(value as FeedbackSeverity)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select severity" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low - Minor issue</SelectItem>
                          <SelectItem value="medium">Medium - Affects functionality but has workaround</SelectItem>
                          <SelectItem value="high">High - Major functionality broken</SelectItem>
                          <SelectItem value="critical">Critical - System unusable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email (Optional)</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Your email for follow-up questions"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      We'll only use this to contact you regarding this feedback.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Screenshot (Optional)</Label>
                    <div className="flex flex-col items-start space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={triggerFileInput}
                      >
                        {screenshot ? "Change Screenshot" : "Upload Screenshot"}
                      </Button>
                      {screenshot && (
                        <p className="text-sm text-muted-foreground">
                          File selected: {screenshot.name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit Feedback"}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              
              <h2 className="text-2xl font-bold mb-2">Thank You!</h2>
              <p className="text-muted-foreground mb-6 max-w-md">
                Your feedback has been submitted successfully. We appreciate your help in making our platform better.
              </p>
              
              <div className="flex space-x-3">
                <Button onClick={() => setIsSubmitted(false)}>
                  Submit Another Feedback
                </Button>
                <Button variant="outline" onClick={() => navigate("/")}>
                  Return to Home
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
