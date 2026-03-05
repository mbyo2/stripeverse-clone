import React, { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetFooter,
} from "@/components/ui/sheet";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Check, Loader2 } from "lucide-react";
import { BusinessLogo } from "./BusinessLogo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const businessSettingsSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters."),
  contactEmail: z.string().email("Please enter a valid email address."),
  contactPhone: z.string().min(10, "Please enter a valid phone number."),
  notificationPreference: z.enum(["email", "sms", "both"]),
  businessAddress: z.string().min(5, "Please enter your business address."),
  autoSettlement: z.boolean().default(false),
  settlementFrequency: z.enum(["daily", "weekly", "monthly"]),
});

type BusinessSettingsFormValues = z.infer<typeof businessSettingsSchema>;

interface BusinessSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BusinessSettings({ isOpen, onClose }: BusinessSettingsProps) {
  const { user } = useAuth();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const form = useForm<BusinessSettingsFormValues>({
    resolver: zodResolver(businessSettingsSchema),
    defaultValues: {
      businessName: "",
      contactEmail: "",
      contactPhone: "",
      notificationPreference: "email",
      businessAddress: "",
      autoSettlement: true,
      settlementFrequency: "weekly",
    },
  });

  useEffect(() => {
    if (!user?.id || !isOpen) return;
    const fetchMerchant = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('merchant_accounts')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const contact = data.contact_info as any || {};
        const address = data.address as any || {};
        form.reset({
          businessName: data.business_name || "",
          contactEmail: contact.email || user.email || "",
          contactPhone: contact.phone || "",
          notificationPreference: contact.notification_preference || "email",
          businessAddress: address.street || "",
          autoSettlement: contact.auto_settlement ?? true,
          settlementFrequency: contact.settlement_frequency || "weekly",
        });
      } else {
        form.reset({
          businessName: "",
          contactEmail: user.email || "",
          contactPhone: "",
          notificationPreference: "email",
          businessAddress: "",
          autoSettlement: true,
          settlementFrequency: "weekly",
        });
      }
      setIsLoading(false);
    };
    fetchMerchant();
  }, [user?.id, isOpen]);

  async function onSubmit(data: BusinessSettingsFormValues) {
    if (!user?.id) return;
    setIsSubmitting(true);

    try {
      const contactInfo = {
        email: data.contactEmail,
        phone: data.contactPhone,
        notification_preference: data.notificationPreference,
        auto_settlement: data.autoSettlement,
        settlement_frequency: data.settlementFrequency,
      };
      const address = { street: data.businessAddress, city: "Lusaka", country: "Zambia" };

      const { data: existing } = await supabase
        .from('merchant_accounts')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('merchant_accounts')
          .update({
            business_name: data.businessName,
            contact_info: contactInfo,
            address: address,
          })
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('merchant_accounts')
          .insert({
            user_id: user.id,
            business_name: data.businessName,
            business_type: 'general',
            contact_info: contactInfo,
            address: address,
          });
        if (error) throw error;
      }

      toast({ title: "Settings saved", description: "Your business settings have been updated." });
      onClose();
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle>Business Settings</SheetTitle>
          <SheetDescription>Configure your business profile and payment preferences.</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-md font-medium">Business Profile</h3>
                <div className="py-4 flex justify-center">
                  <BusinessLogo initialLogo={null} onLogoChange={setLogoFile} disabled={isSubmitting} />
                </div>

                <FormField control={form.control} name="businessName" render={({ field }) => (
                  <FormItem><FormLabel>Business Name</FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>
                )} />

                <FormField control={form.control} name="businessAddress" render={({ field }) => (
                  <FormItem><FormLabel>Business Address</FormLabel><FormControl><Textarea {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>
                )} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="contactEmail" render={({ field }) => (
                    <FormItem><FormLabel>Contact Email</FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="contactPhone" render={({ field }) => (
                    <FormItem><FormLabel>Contact Phone</FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-md font-medium">Notification Preferences</h3>
                <FormField control={form.control} name="notificationPreference" render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Notification Method</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1" disabled={isSubmitting}>
                        <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="email" /></FormControl><FormLabel className="font-normal">Email only</FormLabel></FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="sms" /></FormControl><FormLabel className="font-normal">SMS only</FormLabel></FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="both" /></FormControl><FormLabel className="font-normal">Both email and SMS</FormLabel></FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="space-y-4">
                <h3 className="text-md font-medium">Settlement Preferences</h3>
                <FormField control={form.control} name="autoSettlement" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Automatic Settlement</FormLabel>
                      <FormDescription>Automatically transfer funds to your bank account</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting} /></FormControl>
                  </FormItem>
                )} />

                {form.watch("autoSettlement") && (
                  <FormField control={form.control} name="settlementFrequency" render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Settlement Frequency</FormLabel>
                      <FormControl>
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1" disabled={isSubmitting}>
                          <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="daily" /></FormControl><FormLabel className="font-normal">Daily (Weekdays)</FormLabel></FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="weekly" /></FormControl><FormLabel className="font-normal">Weekly (Every Friday)</FormLabel></FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="monthly" /></FormControl><FormLabel className="font-normal">Monthly (Last day)</FormLabel></FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              <SheetFooter>
                <SheetClose asChild><Button type="button" variant="outline" disabled={isSubmitting}>Cancel</Button></SheetClose>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><Check className="mr-2 h-4 w-4" /> Save Changes</>}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}
