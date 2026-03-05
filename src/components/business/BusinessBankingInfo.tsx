
import React, { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Wallet, Loader2, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const bankingInfoSchema = z.object({
  accountName: z.string().min(2, "Account name must be at least 2 characters."),
  accountNumber: z.string().min(5, "Please enter a valid account number."),
  bankName: z.string().min(2, "Please select a bank."),
  branchCode: z.string().optional(),
  accountType: z.enum(["current", "savings"]),
  swiftCode: z.string().optional(),
});

export type BankingInfoFormValues = z.infer<typeof bankingInfoSchema>;

interface BusinessBankingInfoProps {
  onSave?: (data: BankingInfoFormValues) => void;
  initialValues?: Partial<BankingInfoFormValues>;
  isLoading?: boolean;
}

export function BusinessBankingInfo({ onSave, initialValues, isLoading: externalLoading }: BusinessBankingInfoProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const form = useForm<BankingInfoFormValues>({
    resolver: zodResolver(bankingInfoSchema),
    defaultValues: {
      accountName: "", accountNumber: "", bankName: "", branchCode: "", accountType: "current", swiftCode: "",
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const fetchBanking = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('merchant_accounts')
        .select('contact_info')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const info = data.contact_info as any || {};
        const banking = info.banking || {};
        if (banking.accountName) {
          form.reset({
            accountName: banking.accountName || "",
            accountNumber: banking.accountNumber || "",
            bankName: banking.bankName || "",
            branchCode: banking.branchCode || "",
            accountType: banking.accountType || "current",
            swiftCode: banking.swiftCode || "",
          });
        }
      }
      setIsLoading(false);
    };
    fetchBanking();
  }, [user?.id]);

  const zambianBanks = [
    "Access Bank", "Absa Bank Zambia", "Atlas Mara Bank", "Ecobank Zambia",
    "First Alliance Bank", "First Capital Bank", "First National Bank",
    "Indo-Zambia Bank", "Investrust Bank", "Stanbic Bank",
    "Standard Chartered Bank", "Zambia Industrial Commercial Bank",
    "Zambia National Commercial Bank (Zanaco)"
  ];

  async function onSubmit(data: BankingInfoFormValues) {
    if (onSave) {
      onSave(data);
      return;
    }

    if (!user?.id) return;
    setIsSubmitting(true);

    try {
      // Get current contact_info to merge banking into it
      const { data: merchant } = await supabase
        .from('merchant_accounts')
        .select('contact_info')
        .eq('user_id', user.id)
        .maybeSingle();

      const currentInfo = (merchant?.contact_info as any) || {};
      const updatedInfo = { ...currentInfo, banking: data };

      const { error } = await supabase
        .from('merchant_accounts')
        .update({ contact_info: updatedInfo })
        .eq('user_id', user.id);

      if (error) throw error;

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: "Banking information saved", description: "Your settlement bank account has been updated." });
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const loading = externalLoading || isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Wallet className="mr-2 h-5 w-5" />
          Settlement Bank Account
        </CardTitle>
        <CardDescription>Configure your bank account for receiving payment settlements</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="bankName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Name</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting}>
                      <SelectTrigger><SelectValue placeholder="Select a bank" /></SelectTrigger>
                      <SelectContent>
                        {zambianBanks.map((bank) => (
                          <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="accountName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Holder Name</FormLabel>
                    <FormControl><Input {...field} disabled={isSubmitting} /></FormControl>
                    <FormDescription>Name as it appears on your bank account</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="accountNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl><Input {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="accountType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">Current / Checking</SelectItem>
                          <SelectItem value="savings">Savings</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="branchCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch Code (Optional)</FormLabel>
                    <FormControl><Input {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="swiftCode" render={({ field }) => (
                <FormItem>
                  <FormLabel>SWIFT Code (Optional)</FormLabel>
                  <FormControl><Input {...field} disabled={isSubmitting} /></FormControl>
                  <FormDescription>Required for international transfers only</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="pt-4">
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                  ) : saved ? (
                    <><CheckCircle className="mr-2 h-4 w-4" /> Saved</>
                  ) : (
                    "Save Bank Information"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
