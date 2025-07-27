import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { useRoleManagement } from "@/hooks/useRoleManagement";

const RoleRequestForm = () => {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { requestRoleChange } = useRoleManagement();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    
    setIsSubmitting(true);
    try {
      await requestRoleChange(selectedRole, reason);
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