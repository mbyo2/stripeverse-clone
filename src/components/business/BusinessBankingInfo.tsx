
import React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Wallet } from "lucide-react";

const bankingInfoSchema = z.object({
  accountName: z.string().min(2, {
    message: "Account name must be at least 2 characters.",
  }),
  accountNumber: z.string().min(5, {
    message: "Please enter a valid account number.",
  }),
  bankName: z.string().min(2, {
    message: "Please select a bank.",
  }),
  branchCode: z.string().optional(),
  accountType: z.enum(["current", "savings"], {
    required_error: "Please select an account type.",
  }),
  swiftCode: z.string().optional(),
});

export type BankingInfoFormValues = z.infer<typeof bankingInfoSchema>;

const defaultValues: Partial<BankingInfoFormValues> = {
  accountName: "",
  accountNumber: "",
  bankName: "",
  branchCode: "",
  accountType: "current",
  swiftCode: "",
};

interface BusinessBankingInfoProps {
  onSave?: (data: BankingInfoFormValues) => void;
  initialValues?: Partial<BankingInfoFormValues>;
  isLoading?: boolean;
}

export function BusinessBankingInfo({ 
  onSave, 
  initialValues = defaultValues,
  isLoading = false
}: BusinessBankingInfoProps) {
  const form = useForm<BankingInfoFormValues>({
    resolver: zodResolver(bankingInfoSchema),
    defaultValues: {
      ...defaultValues,
      ...initialValues
    },
  });

  function onSubmit(data: BankingInfoFormValues) {
    if (onSave) {
      onSave(data);
    } else {
      // For demo purposes, show toast
      console.log("Banking info saved:", data);
      
      toast({
        title: "Banking information updated",
        description: "Your settlement bank account has been updated.",
      });
    }
  }

  // List of Zambian banks for demo purposes
  const zambianBanks = [
    "Bank of Zambia",
    "Access Bank",
    "Absa Bank Zambia",
    "Atlas Mara Bank",
    "Ecobank Zambia",
    "First Alliance Bank",
    "First Capital Bank",
    "First National Bank",
    "Indo-Zambia Bank",
    "Investrust Bank",
    "Stanbic Bank",
    "Standard Chartered Bank",
    "Zambia Industrial Commercial Bank",
    "Zambia National Commercial Bank"
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Wallet className="mr-2 h-5 w-5" />
          Settlement Bank Account
        </CardTitle>
        <CardDescription>
          Configure your bank account for receiving payments
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="bankName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Name</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {zambianBanks.map((bank) => (
                          <SelectItem key={bank} value={bank}>
                            {bank}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="accountName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Holder Name</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isLoading} />
                    </FormControl>
                    <FormDescription>
                      Name as it appears on your bank account
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="accountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isLoading}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">Current / Checking</SelectItem>
                          <SelectItem value="savings">Savings</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="branchCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch Code (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="swiftCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SWIFT Code (Optional)</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isLoading} />
                  </FormControl>
                  <FormDescription>
                    Required for international transfers only
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-4">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Processing..." : "Save Bank Information"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
