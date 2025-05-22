
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BugIcon, Lightbulb, MessageCircle, ExternalLink, Clock, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface FeedbackItem {
  id: string;
  type: "bug" | "feature" | "general";
  title: string;
  description: string;
  email: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  app_version: string;
  device_info: Record<string, any>;
  screenshot_included: boolean | null;
  created_at: string;
}

const FeedbackDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FeedbackItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Fetch feedback items
  useEffect(() => {
    const fetchFeedbackItems = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from("beta_feedback")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching feedback:", error);
          toast({
            title: "Error",
            description: "Failed to load feedback items. Please try again.",
            variant: "destructive",
          });
          return;
        }

        setFeedbackItems(data as FeedbackItem[]);
      } catch (err) {
        console.error("Unexpected error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFeedbackItems();
  }, [toast]);

  const openDetails = (item: FeedbackItem) => {
    setSelectedItem(item);
    setDetailsOpen(true);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setSelectedItem(null);
  };

  const deleteFeedback = async (id: string) => {
    try {
      // First check if there's a screenshot to delete
      const item = feedbackItems.find(item => item.id === id);
      if (item?.screenshot_included) {
        // We should delete the screenshot from storage, but we don't know the filename
        // It was saved with timestamp-filename.ext format in the original code
        // For a proper implementation, we should store the filename in the feedback record
      }

      const { error } = await supabase
        .from("beta_feedback")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting feedback:", error);
        toast({
          title: "Delete Failed",
          description: "Could not delete the feedback item.",
          variant: "destructive",
        });
        return;
      }

      // Update local state
      setFeedbackItems(feedbackItems.filter(item => item.id !== id));
      
      if (detailsOpen && selectedItem?.id === id) {
        closeDetails();
      }

      toast({
        title: "Feedback Deleted",
        description: "The feedback item has been removed.",
      });

    } catch (err) {
      console.error("Unexpected error:", err);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const getFeedbackIcon = (type: string) => {
    switch (type) {
      case "bug":
        return <BugIcon className="h-5 w-5" />;
      case "feature":
        return <Lightbulb className="h-5 w-5" />;
      case "general":
      default:
        return <MessageCircle className="h-5 w-5" />;
    }
  };

  const getSeverityColor = (severity: string | null) => {
    switch (severity) {
      case "critical":
        return "bg-red-500";
      case "high":
        return "bg-orange-500";
      case "medium":
        return "bg-yellow-500";
      case "low":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const filteredItems = activeTab === "all" 
    ? feedbackItems 
    : feedbackItems.filter(item => item.type === activeTab);

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Beta Feedback Dashboard</h1>
          <Button variant="outline" onClick={() => navigate("/feedback")}>
            Submit New Feedback
          </Button>
        </div>

        <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 mb-8">
            <TabsTrigger value="all">All Feedback</TabsTrigger>
            <TabsTrigger value="bug">Bug Reports</TabsTrigger>
            <TabsTrigger value="feature">Feature Requests</TabsTrigger>
            <TabsTrigger value="general">General Feedback</TabsTrigger>
          </TabsList>
          
          <TabsContent value={activeTab} className="mt-0">
            {isLoading ? (
              <div className="text-center py-10">
                <p>Loading feedback items...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-10 border rounded-md bg-secondary/5">
                <p className="text-muted-foreground">No feedback items found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredItems.map((item) => (
                  <Card key={item.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center">
                          <div className="mr-2">
                            {getFeedbackIcon(item.type)}
                          </div>
                          <CardTitle className="text-lg truncate">{item.title}</CardTitle>
                        </div>
                        <Badge 
                          className={`ml-2 ${item.severity ? getSeverityColor(item.severity) : 'bg-gray-500'}`}
                        >
                          {item.severity || "N/A"}
                        </Badge>
                      </div>
                      <CardDescription className="flex items-center text-xs">
                        <Clock className="h-3 w-3 mr-1" /> 
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        <span className="mx-2">•</span>
                        v{item.app_version}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                        {item.description}
                      </p>
                      <div className="flex justify-between items-center">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => openDetails(item)}
                        >
                          View Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-100"
                          onClick={() => deleteFeedback(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
      <Footer />

      {/* Feedback Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center mb-2">
                      {getFeedbackIcon(selectedItem.type)}
                      <DialogTitle className="ml-2">{selectedItem.title}</DialogTitle>
                    </div>
                    <DialogDescription className="flex items-center gap-2">
                      <Badge>v{selectedItem.app_version}</Badge>
                      {selectedItem.severity && (
                        <Badge className={getSeverityColor(selectedItem.severity)}>
                          {selectedItem.severity}
                        </Badge>
                      )}
                      <span>{new Date(selectedItem.created_at).toLocaleString()}</span>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              
              <div className="space-y-4 mt-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
                  <div className="p-3 bg-muted rounded-md whitespace-pre-wrap">
                    {selectedItem.description}
                  </div>
                </div>

                {selectedItem.email && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">Contact Email</h3>
                    <div className="p-3 bg-muted rounded-md">
                      <a href={`mailto:${selectedItem.email}`} className="flex items-center hover:text-primary">
                        {selectedItem.email}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Device Information</h3>
                  <div className="p-3 bg-muted rounded-md overflow-x-auto">
                    <pre className="text-xs">
                      {JSON.stringify(selectedItem.device_info, null, 2)}
                    </pre>
                  </div>
                </div>

                {selectedItem.screenshot_included && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">Screenshot</h3>
                    <div className="p-3 bg-muted rounded-md text-center">
                      <p className="text-xs text-muted-foreground">
                        Screenshot was included, but the URL was not saved in the database.
                        <br />
                        For a complete implementation, we would need to store the file path in the feedback record.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 mt-4">
                <Button variant="outline" onClick={closeDetails}>
                  Close
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    deleteFeedback(selectedItem.id);
                    closeDetails();
                  }}
                >
                  Delete
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FeedbackDashboard;
