
import { useState, useEffect } from "react";
import { ArrowLeftRight, Bell, Info, Megaphone, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "react-router-dom";

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: "transaction" | "system" | "alert";
  read: boolean;
  created_at: string;
}

const NotificationBell = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Fetch notifications
  useEffect(() => {
    if (!user) return;
    
    const fetchNotifications = async () => {
      setLoading(true);
      try {
        // Cast the supabase response to the correct type with explicit typing
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        
        // Use type assertion to convert data to the expected Notification[]
        setNotifications(data as unknown as Notification[]);
        setUnreadCount((data as unknown as Notification[]).filter((notification: Notification) => !notification.read).length);
      } catch (error) {
        console.error("Error fetching notifications:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();

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
          setUnreadCount((count) => count + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Mark notifications as read
  const markAsRead = async (notificationId?: string) => {
    try {
      if (notificationId) {
        // Mark single notification as read
        const { error } = await supabase
          .from("notifications")
          .update({ read: true } as any)
          .eq("id", notificationId);

        if (error) throw error;

        setNotifications(
          notifications.map((n) =>
            n.id === notificationId ? { ...n, read: true } : n
          )
        );
        setUnreadCount(Math.max(0, unreadCount - 1));
      } else {
        // Mark all as read
        const { error } = await supabase
          .from("notifications")
          .update({ read: true } as any)
          .eq("user_id", user?.id)
          .eq("read", false);

        if (error) throw error;

        setNotifications(
          notifications.map((n) => ({ ...n, read: true }))
        );
        setUnreadCount(0);
      }
    } catch (error) {
      console.error("Error marking notifications as read:", error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
      return "Just now";
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getNotificationIcon = (type: string) => {
    // One neutral token disc for every type (dark-mode safe); the icon
    // itself carries the meaning — no emoji, no pastel fills.
    const disc = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground";
    switch (type) {
      case "transaction":
        return <div className={disc}><ArrowLeftRight className="h-4 w-4" /></div>;
      case "alert":
        return <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert className="h-4 w-4" /></div>;
      case "system":
        return <div className={disc}><Info className="h-4 w-4" /></div>;
      default:
        return <div className={disc}><Megaphone className="h-4 w-4" /></div>;
    }
  };
  
  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="relative p-2 rounded-full text-white hover:bg-white/10 hover:text-white">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 px-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px]"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-medium">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAsRead()}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px] p-2">
          {loading ? (
            <div className="space-y-1 p-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3 p-3">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <Bell className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">No notifications yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Payments, security alerts and account updates will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {notifications.map((notification) => (
                <div 
                  key={notification.id}
                  className={`flex items-start p-3 gap-3 rounded-lg hover:bg-muted/50 transition-colors ${!notification.read ? "bg-muted/30" : ""}`}
                  onClick={() => markAsRead(notification.id)}
                >
                  {getNotificationIcon(notification.type)}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm line-clamp-1">{notification.title}</p>
                      <p className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(notification.created_at)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <Separator />
        <div className="p-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full" 
            onClick={() => navigate("/notifications")}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
