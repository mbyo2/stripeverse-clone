
import React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

// Define the form schema using zod
const businessSettingsSchema = z.object({
  businessName: z.string().min(2, {
    message: "Business name must be at least 2 characters.",
  }),
  contactEmail: z.string().email({
    message: "Please enter a valid email address.",
  }),
  contactPhone: z.string().min(10, {
    message: "Please enter a valid phone number.",
  }),
  notificationPreference: z.enum(["email", "sms", "both"], {
    required_error: "Please select a notification preference.",
  }),
  businessAddress: z.string().min(5, {
    message: "Please enter your business address.",
  }),
  autoSettlement: z.boolean().default(false),
  settlementFrequency: z.enum(["daily", "weekly", "monthly"], {
    required_error: "Please select a settlement frequency.",
  }),
});

type BusinessSettingsFormValues = z.infer<typeof businessSettingsSchema>;

// Default values for the form
const defaultValues: Partial<BusinessSettingsFormValues> = {
  businessName: "Acme Corporation",
  contactEmail: "contact@acmecorp.com",
  contactPhone: "0970123456",
  notificationPreference: "email",
  businessAddress: "123 Main St, Lusaka, Zambia",
  autoSettlement: true,
  settlementFrequency: "weekly",
};

interface BusinessSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BusinessSettings({ isOpen, onClose }: BusinessSettingsProps) {
  const form = useForm<BusinessSettingsFormValues>({
    resolver: zodResolver(businessSettingsSchema),
    defaultValues,
  });

  function onSubmit(data: BusinessSettingsFormValues) {
    // In a real app, we would save the settings to the backend
    console.log("Settings saved:", data);
    
    toast({
      title: "Settings updated",
      description: "Your business settings have been saved successfully.",
    });
    
    onClose();
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle>Business Settings</SheetTitle>
          <SheetDescription>
            Configure your business profile and payment preferences.
          </SheetDescription>
        </SheetHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-md font-medium">Business Information</h3>
              
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="businessAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Address</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            
            <div className="space-y-4">
              <h3 className="text-md font-medium">Notification Preferences</h3>
              <FormField
                control={form.control}
                name="notificationPreference"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Notification Method</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="email" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Email only
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="sms" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            SMS only
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="both" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Both email and SMS
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="space-y-4">
              <h3 className="text-md font-medium">Settlement Preferences</h3>
              
              <FormField
                control={form.control}
                name="autoSettlement"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Automatic Settlement
                      </FormLabel>
                      <FormDescription>
                        Automatically transfer funds to your bank account
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              
              {form.watch("autoSettlement") && (
                <FormField
                  control={form.control}
                  name="settlementFrequency"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Settlement Frequency</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="daily" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Daily (Weekdays)
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="weekly" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Weekly (Every Friday)
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="monthly" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Monthly (Last day)
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            
            <SheetFooter>
              <SheetClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </SheetClose>
              <Button type="submit">
                <Check className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

// Add missing import 
import { FormDescription } from "@/components/ui/form";
