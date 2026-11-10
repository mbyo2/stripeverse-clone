
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

    // If there's a screenshot, upload it to storage. The bucket's
    // upload policy is user-scoped (foldername[1] = auth.uid()), so
    // the file goes under the uploader's own folder — the old shared
    // `feedback/` prefix never matched the policy and every upload
    // was 403-denied (sweep 2026-11-10, migration 20261258).
    if (feedbackData.screenshot) {
      const timestamp = new Date().getTime();
      const fileName = `${timestamp}-${feedbackData.screenshot.name.replace(/\s+/g, '-')}`;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: uploadError } = await supabase.storage
          .from('beta_screenshots')
          .upload(`${user.id}/${fileName}`, feedbackData.screenshot);

        if (uploadError) {
          console.error("Error uploading screenshot:", uploadError);
          // We still consider the feedback submitted even if screenshot upload fails
        }
      } else {
        console.error("Error uploading screenshot: no signed-in user for the user-scoped upload");
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
