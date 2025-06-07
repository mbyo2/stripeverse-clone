
import React from 'react';
import { useRoles } from "@/contexts/RoleContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { Users, Shield, Crown, TestTube, ChevronDown } from "lucide-react";

export const RoleSwitcher = () => {
  const { roles, hasRole } = useRoles();
  const navigate = useNavigate();

  const roleConfig = {
    user: {
      label: "User Dashboard",
      icon: <Users className="h-4 w-4" />,
      path: "/user-dashboard",
      color: "bg-blue-500"
    },
    business: {
      label: "Business Dashboard",
      icon: <Shield className="h-4 w-4" />,
      path: "/business",
      color: "bg-green-500"
    },
    admin: {
      label: "Admin Dashboard",
      icon: <Crown className="h-4 w-4" />,
      path: "/admin-dashboard",
      color: "bg-red-500"
    },
    beta_tester: {
      label: "Beta Tester Dashboard",
      icon: <TestTube className="h-4 w-4" />,
      path: "/beta-dashboard",
      color: "bg-amber-500"
    }
  };

  const availableRoles = roles.filter(role => roleConfig[role]);

  if (availableRoles.length <= 1) {
    return null; // Don't show switcher if user has only one role
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Switch Dashboard
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {availableRoles.map((role) => {
          const config = roleConfig[role];
          return (
            <DropdownMenuItem
              key={role}
              onClick={() => navigate(config.path)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {config.icon}
                <span>{config.label}</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {role.replace('_', ' ')}
              </Badge>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
