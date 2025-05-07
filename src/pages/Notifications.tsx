
import { useState, useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bell, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Notification } from "@/components/notifications/NotificationBell";
import { useNotifications } from "@/contexts/NotificationContext";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const Notifications = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { enablePushNotifications, updateEmailPreferences } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState("all");
  const [emailPreferences, setEmailPreferences] = useState({
    transactions: true,
    marketing: false,
    security: true,
    news: false
  });
  
  useEffect(() => {
    if (!user) return;
    
    const fetchNotifications = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
          
        if (error) throw error;
        
        setNotifications(data as unknown as Notification[]);
      } catch (error) {
        console.error("Error fetching notifications:", error);
        toast({
          title: "Failed to load notifications",
          description: "Please try again later",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };
    
    const fetchPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from("notification_preferences")
          .select("*")
          .eq("user_id", user.id)
          .single();
          
        if (error && error.code !== "PGRST116") {
          throw error;
        }
        
        if (data) {
          setEmailPreferences({
            transactions: data.email_transactions,
            marketing: data.email_marketing,
            security: data.email_security,
            news: data.email_news
          });
        }
      } catch (error) {
        console.error("Error fetching notification preferences:", error);
      }
    };
    
    fetchNotifications();
    fetchPreferences();
    
    // Set up real-time subscription
    const channel = supabase
      .channel("notification_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public", 
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as unknown as Notification;
          setNotifications((current) => [newNotification, ...current]);
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast]);
  
  const handleEnablePushNotifications = async () => {
    await enablePushNotifications();
  };
  
  const handleEmailPreferenceChange = async () => {
    await updateEmailPreferences(emailPreferences);
  };
  
  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true } as any)
        .eq("user_id", user?.id)
        .eq("read", false);
        
      if (error) throw error;
      
      setNotifications(
        notifications.map((n) => ({ ...n, read: true }))
      );
      
      toast({
        title: "All notifications marked as read",
      });
    } catch (error) {
      console.error("Error marking notifications as read:", error);
      toast({
        title: "Failed to update notifications",
        description: "Please try again later",
        variant: "destructive"
      });
    }
  };
  
  const deleteAllNotifications = async () => {
    try {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("user_id", user?.id);
        
      if (error) throw error;
      
      setNotifications([]);
      
      toast({
        title: "All notifications deleted",
      });
    } catch (error) {
      console.error("Error deleting notifications:", error);
      toast({
        title: "Failed to delete notifications",
        description: "Please try again later",
        variant: "destructive"
      });
    }
  };

  const getFilteredNotifications = () => {
    switch (activeTab) {
      case "transactions":
        return notifications.filter(n => n.type === "transaction");
      case "alerts":
        return notifications.filter(n => n.type === "alert");
      case "system":
        return notifications.filter(n => n.type === "system");
      case "unread":
        return notifications.filter(n => !n.read);
      default:
        return notifications;
    }
  };
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };
  
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Bell className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Notifications</h1>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={markAllAsRead}
              disabled={!notifications.some(n => !n.read)}
            >
              Mark all as read
            </Button>
            <Button 
              variant="outline" 
              onClick={deleteAllNotifications}
              disabled={notifications.length === 0}
            >
              Clear all
            </Button>
          </div>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
          
          <TabsContent value={activeTab}>
            <Card>
              <CardContent className="pt-6">
                {loading ? (
                  <div className="flex justify-center items-center h-40">
                    <p>Loading notifications...</p>
                  </div>
                ) : getFilteredNotifications().length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40">
                    <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No notifications to display</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getFilteredNotifications().map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 rounded-lg border ${!notification.read ? "bg-muted/30" : ""}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium">{notification.title}</h3>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(notification.created_at)}
                          </span>
                        </div>
                        <p className="text-sm mb-2">{notification.message}</p>
                        <div className="flex justify-between items-center">
                          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                            {notification.type}
                          </span>
                          {!notification.read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("notifications")
                                  .update({ read: true } as any)
                                  .eq("id", notification.id);
                                  
                                if (!error) {
                                  setNotifications(
                                    notifications.map((n) =>
                                      n.id === notification.id ? { ...n, read: true } : n
                                    )
                                  );
                                }
                              }}
                            >
                              Mark as read
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-6">
            <Settings className="h-5 w-5" />
            <h2 className="text-xl font-semibold">Notification Settings</h2>
          </div>
          
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Push Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Enable push notifications to receive alerts even when you're not using the app.
              </p>
              <Button onClick={handleEnablePushNotifications}>
                Enable Push Notifications
              </Button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Email Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-6">
                Choose which types of email notifications you want to receive.
              </p>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="transactions">Transaction Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive emails about deposits, withdrawals, and payments
                    </p>
                  </div>
                  <Switch
                    id="transactions"
                    checked={emailPreferences.transactions}
                    onCheckedChange={(checked) => {
                      setEmailPreferences(prev => ({ ...prev, transactions: checked }));
                      handleEmailPreferenceChange();
                    }}
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="security">Security Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive emails about login attempts, password changes, and security concerns
                    </p>
                  </div>
                  <Switch
                    id="security"
                    checked={emailPreferences.security}
                    onCheckedChange={(checked) => {
                      setEmailPreferences(prev => ({ ...prev, security: checked }));
                      handleEmailPreferenceChange();
                    }}
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="news">News & Updates</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive emails about new features and platform updates
                    </p>
                  </div>
                  <Switch
                    id="news"
                    checked={emailPreferences.news}
                    onCheckedChange={(checked) => {
                      setEmailPreferences(prev => ({ ...prev, news: checked }));
                      handleEmailPreferenceChange();
                    }}
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="marketing">Marketing</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive emails about promotions, offers, and marketing campaigns
                    </p>
                  </div>
                  <Switch
                    id="marketing"
                    checked={emailPreferences.marketing}
                    onCheckedChange={(checked) => {
                      setEmailPreferences(prev => ({ ...prev, marketing: checked }));
                      handleEmailPreferenceChange();
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default Notifications;
