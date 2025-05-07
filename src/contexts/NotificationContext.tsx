
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Notification } from "@/components/notifications/NotificationBell";

interface NotificationContextType {
  createNotification: (notification: CreateNotificationParams) => Promise<void>;
  enablePushNotifications: () => Promise<boolean>;
  updateEmailPreferences: (preferences: EmailPreferences) => Promise<void>;
  isLoading: boolean;
}

interface CreateNotificationParams {
  title: string;
  message: string;
  type: "transaction" | "system" | "alert";
}

interface EmailPreferences {
  transactions: boolean;
  marketing: boolean;
  security: boolean;
  news: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Create a new notification
  const createNotification = async ({ title, message, type }: CreateNotificationParams) => {
    try {
      if (!user) return;
      
      setIsLoading(true);
      
      const { error } = await supabase
        .from("notifications")
        .insert({
          user_id: user.id,
          title,
          message,
          type,
          read: false
        });
      
      if (error) throw error;
      
    } catch (error: any) {
      console.error("Error creating notification:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Request push notification permissions and register the device
  const enablePushNotifications = async (): Promise<boolean> => {
    try {
      // Check if push notifications are supported
      if (!("Notification" in window)) {
        toast({
          title: "Push notifications not supported",
          description: "Your browser doesn't support push notifications",
          variant: "destructive"
        });
        return false;
      }

      // Request permission
      const permission = await Notification.requestPermission();
      
      if (permission !== "granted") {
        toast({
          title: "Permission denied",
          description: "You need to allow push notifications in your browser settings",
          variant: "destructive"
        });
        return false;
      }
      
      toast({
        title: "Push notifications enabled",
        description: "You will now receive push notifications"
      });
      
      // In a real implementation, we would register the device with the backend
      // await registerDeviceForPushNotifications();
      
      return true;
    } catch (error) {
      console.error("Error setting up push notifications:", error);
      return false;
    }
  };

  // Update email notification preferences
  const updateEmailPreferences = async (preferences: EmailPreferences) => {
    try {
      if (!user) return;
      
      setIsLoading(true);
      
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({
          user_id: user.id,
          email_transactions: preferences.transactions,
          email_marketing: preferences.marketing,
          email_security: preferences.security,
          email_news: preferences.news
        });
        
      if (error) throw error;
      
      toast({
        title: "Preferences updated",
        description: "Your email notification preferences have been updated"
      });
      
    } catch (error: any) {
      toast({
        title: "Error updating preferences",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        createNotification,
        enablePushNotifications,
        updateEmailPreferences,
        isLoading
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
};
