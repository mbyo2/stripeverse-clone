import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export const useContactForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const submitContactForm = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      // Using any to bypass TypeScript until types are regenerated
      const { error } = await (supabase as any)
        .from('contact_messages')
        .insert({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message
        });

      if (error) throw error;
      
      toast({
        title: "Message Sent",
        description: "Thank you for contacting us. We'll get back to you soon.",
      });
      
      return true;
    } catch (error) {
      console.error('Error submitting contact form:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const subscribeToNewsletter = async (email: string) => {
    setIsSubmitting(true);
    try {
      // Using any to bypass TypeScript until types are regenerated
      const { error } = await (supabase as any)
        .from('newsletter_subscriptions')
        .insert({ email });

      if (error) {
        // If it's a unique constraint violation, the user is already subscribed
        if (error.code === '23505') {
          toast({
            title: "Already Subscribed",
            description: "You're already subscribed to our newsletter.",
          });
          return true;
        }
        throw error;
      }
      
      toast({
        title: "Subscribed!",
        description: "You've been subscribed to our newsletter.",
      });
      
      return true;
    } catch (error) {
      console.error('Error subscribing to newsletter:', error);
      toast({
        title: "Error",
        description: "Failed to subscribe. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    submitContactForm,
    subscribeToNewsletter,
    isSubmitting
  };
};