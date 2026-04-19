import React, { useState } from 'react';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { useRoleManagement } from "@/hooks/useRoleManagement";
import { toast } from "@/hooks/use-toast";

const ALLOWED_ROLES = ['beta_tester', 'business', 'moderator'] as const;

const roleRequestSchema = z.object({
  selectedRole: z.enum(ALLOWED_ROLES, {
    errorMap: () => ({ message: 'Please select a valid role' }),
  }),
  reason: z
    .string()
    .trim()
    .max(500, { message: 'Reason must be 500 characters or fewer' })
    .optional()
    .or(z.literal('')),
});

const RoleRequestForm = () => {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { requestRoleChange } = useRoleManagement();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = roleRequestSchema.safeParse({ selectedRole, reason });
    if (!result.success) {
      const firstError = result.error.errors[0]?.message ?? 'Invalid input';
      toast({
        title: 'Invalid request',
        description: firstError,
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await requestRoleChange(result.data.selectedRole, result.data.reason ?? '');
      setSelectedRole('');
      setReason('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const roles = [
    { value: 'beta_tester', label: 'Beta Tester', description: 'Access to beta features and testing' },
    { value: 'business', label: 'Business', description: 'Business account features' },
    { value: 'moderator', label: 'Moderator', description: 'Content moderation privileges' }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Request Role Change
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role to request" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    <div>
                      <div className="font-medium">{role.label}</div>
                      <div className="text-sm text-muted-foreground">{role.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why do you need this role?"
              rows={3}
            />
          </div>

          <Button 
            type="submit" 
            disabled={!selectedRole || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Request'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default RoleRequestForm;