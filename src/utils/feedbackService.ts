
import { supabase } from "@/integrations/supabase/client";

export interface FeedbackSubmission {
  type: "bug" | "feature" | "general";
  title: string;
  description: string;
  email?: string;
  severity?: "low" | "medium" | "high" | "critical";
  screenshot?: File;
  appVersion: string;
  deviceInfo: Record<string, any>;
}

export const submitFeedback = async (feedbackData: FeedbackSubmission): Promise<boolean> => {
  try {
    // Create feedback entry in Supabase
    // Using 'any' type assertion to work around TypeScript issues with newly created tables
    const { error } = await (supabase as any)
      .from('beta_feedback')
      .insert([{
        type: feedbackData.type,
        title: feedbackData.title,
        description: feedbackData.description,
        email: feedbackData.email || null,
        severity: feedbackData.severity || null,
        app_version: feedbackData.appVersion,
        device_info: feedbackData.deviceInfo,
        screenshot_included: !!feedbackData.screenshot
      }]);

    if (error) {
      console.error("Error submitting feedback:", error);
      return false;
    }

    // If there's a screenshot, upload it to storage
    if (feedbackData.screenshot) {
      const timestamp = new Date().getTime();
      const fileName = `${timestamp}-${feedbackData.screenshot.name.replace(/\s+/g, '-')}`;
      
      const { error: uploadError } = await supabase.storage
        .from('beta_screenshots')
        .upload(`feedback/${fileName}`, feedbackData.screenshot);
        
      if (uploadError) {
        console.error("Error uploading screenshot:", uploadError);
        // We still consider the feedback submitted even if screenshot upload fails
      }
    }

    return true;
  } catch (err) {
    console.error("Unexpected error submitting feedback:", err);
    return false;
  }
};

export const getDeviceInfo = (): Record<string, any> => {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};
