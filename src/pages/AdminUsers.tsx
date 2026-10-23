import { toUserFacingError } from "@/utils/userFacingError";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Search, UserCheck, UserX, Eye, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
  /** Primary role (admin > business > beta_tester > user) — used for the filter. */
  role?: string;
  /** Every role row the user holds in user_roles. */
  roles: string[];
  email?: string;
}

const BASE_ROLES = ["user", "business", "beta_tester"] as const;
type BaseRole = (typeof BASE_ROLES)[number];

const ROLE_PRIORITY = ["admin", "business", "beta_tester", "user"];

const sortRoles = (roles: string[]) =>
  [...roles].sort(
    (a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b)
  );

const primaryRole = (roles: string[]) => sortRoles(roles)[0] || "user";

const baseRoleOf = (roles: string[]): BaseRole =>
  (BASE_ROLES.find((r) => roles.includes(r)) ?? "user") as BaseRole;

const roleBadgeVariant = (role: string) =>
  role === "admin" ? "destructive" : role === "business" ? "default" : "secondary";

interface KycRow {
  id: number;
  user_id: string | null;
  level: string;
  first_name: string | null;
  last_name: string | null;
  id_type: string | null;
  id_number: string | null;
  created_at: string | null;
  verified_at: string | null;
}

const AdminUsers = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [kycRequests, setKycRequests] = useState<KycRow[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [confirmGrantAdmin, setConfirmGrantAdmin] = useState(false);
  const [roleActionBusy, setRoleActionBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [profilesRes, rolesRes, kycRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("kyc_verifications")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      const rolesByUser = new Map<string, string[]>();
      rolesRes.data?.forEach((r) => {
        const held = rolesByUser.get(r.user_id) ?? [];
        held.push(r.role);
        rolesByUser.set(r.user_id, held);
      });

      const enrichedUsers: UserRow[] = (profilesRes.data || []).map((p) => {
        const roles = rolesByUser.get(p.id)?.length
          ? rolesByUser.get(p.id)!
          : ["user"];
        return {
          ...p,
          roles,
          role: primaryRole(roles),
        };
      });

      setUsers(enrichedUsers);
      setKycRequests((kycRes.data || []) as KycRow[]);
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to load users", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveKyc = async (kycId: number, userId: string | null) => {
    if (!userId) return;
    const { error } = await supabase
      .from("kyc_verifications")
      .update({ level: "full", verified_at: new Date().toISOString() })
      .eq("id", kycId);

    if (error) {
      toast({ title: "Error", description: "Failed to approve KYC", variant: "destructive" });
    } else {
      toast({ title: "KYC Approved", description: "User verification has been approved." });
      fetchData();
    }
  };

  const handleRejectKyc = async (kycId: number) => {
    const { error } = await supabase
      .from("kyc_verifications")
      .update({ level: "none", metadata: { rejected: true, rejected_at: new Date().toISOString() } })
      .eq("id", kycId);

    if (error) {
      toast({ title: "Error", description: "Failed to reject KYC", variant: "destructive" });
    } else {
      toast({ title: "KYC Rejected", description: "Verification has been rejected." });
      fetchData();
    }
  };

  /** Reflect a role change in the open detail dialog, then refresh the table. */
  const afterRoleChange = (user: UserRow, roles: string[]) => {
    setSelectedUser({ ...user, roles, role: primaryRole(roles) });
    setConfirmGrantAdmin(false);
    fetchData();
  };

  const handleGrantAdmin = async (user: UserRow) => {
    setRoleActionBusy(true);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: user.id, role: "admin" });
    setRoleActionBusy(false);

    if (error) {
      toast({
        title: "Error",
        description: toUserFacingError(error, "Failed to grant admin"),
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Admin granted",
      description: `${user.first_name || ""} ${user.last_name || ""} is now an admin.`,
    });
    afterRoleChange(user, [...user.roles, "admin"]);
  };

  const handleRemoveAdmin = async (user: UserRow) => {
    if (user.id === currentUserId) {
      toast({
        title: "Not allowed",
        description: "You cannot remove your own admin role.",
        variant: "destructive",
      });
      return;
    }
    setRoleActionBusy(true);
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", user.id)
      .eq("role", "admin");
    setRoleActionBusy(false);

    if (error) {
      toast({
        title: "Error",
        description: toUserFacingError(error, "Failed to remove admin"),
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Admin removed",
      description: `${user.first_name || ""} ${user.last_name || ""} is no longer an admin.`,
    });
    afterRoleChange(
      user,
      user.roles.filter((r) => r !== "admin")
    );
  };

  const handleSetBaseRole = async (user: UserRow, newBaseRole: BaseRole) => {
    if (baseRoleOf(user.roles) === newBaseRole && user.roles.includes(newBaseRole)) {
      return;
    }
    setRoleActionBusy(true);
    // Replace only the non-admin role rows — the admin row is never touched.
    const { error: deleteError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", user.id)
      .in("role", [...BASE_ROLES]);
    if (deleteError) {
      setRoleActionBusy(false);
      toast({
        title: "Error",
        description: toUserFacingError(deleteError, "Failed to update base role"),
        variant: "destructive",
      });
      return;
    }
    const { error: insertError } = await supabase
      .from("user_roles")
      .insert({ user_id: user.id, role: newBaseRole });
    setRoleActionBusy(false);

    if (insertError) {
      toast({
        title: "Error",
        description: toUserFacingError(insertError, "Failed to update base role"),
        variant: "destructive",
      });
      fetchData();
      return;
    }
    toast({
      title: "Base role updated",
      description: `${user.first_name || ""} ${user.last_name || ""} now has the ${newBaseRole} role.`,
    });
    afterRoleChange(user, [
      ...user.roles.filter((r) => !BASE_ROLES.includes(r as BaseRole)),
      newBaseRole,
    ]);
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      !search ||
      (u.first_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (u.last_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (u.phone?.includes(search) ?? false);
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const pendingKyc = kycRequests.filter(
    (k) => k.level === "basic" || (k.level === "none" && k.first_name)
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">User Management</h1>
        <p className="text-muted-foreground mb-6">
          Manage users, review KYC submissions, and oversee account activity.
        </p>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList>
            <TabsTrigger value="users">All Users ({users.length})</TabsTrigger>
            <TabsTrigger value="kyc">
              KYC Reviews
              {pendingKyc.length > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">
                  {pendingKyc.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or phone..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Filter role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="beta_tester">Beta Tester</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.first_name || ""} {u.last_name || ""}
                          {!u.first_name && !u.last_name && (
                            <span className="text-muted-foreground italic">No name</span>
                          )}
                        </TableCell>
                        <TableCell>{u.phone || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {sortRoles(u.roles).map((r) => (
                              <Badge key={r} variant={roleBadgeVariant(r)}>
                                {r}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.created_at
                            ? new Date(u.created_at).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(u);
                              setConfirmGrantAdmin(false);
                              setShowDetail(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="kyc">
            <Card>
              <CardHeader>
                <CardTitle>KYC Verification Queue</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingKyc.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No pending KYC verifications
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>ID Type</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingKyc.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell className="font-medium">
                            {k.first_name} {k.last_name}
                          </TableCell>
                          <TableCell>{k.id_type || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{k.level}</Badge>
                          </TableCell>
                          <TableCell>
                            {k.created_at
                              ? new Date(k.created_at).toLocaleDateString()
                              : "—"}
                          </TableCell>
                          <TableCell className="space-x-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApproveKyc(k.id, k.user_id)}
                            >
                              <UserCheck className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRejectKyc(k.id)}
                            >
                              <UserX className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* User Detail Dialog */}
        <Dialog
          open={showDetail}
          onOpenChange={(open) => {
            setShowDetail(open);
            if (!open) setConfirmGrantAdmin(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>User Details</DialogTitle>
              <DialogDescription>
                Viewing profile for {selectedUser?.first_name} {selectedUser?.last_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs">{selectedUser?.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{selectedUser?.phone || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joined</span>
                <span>
                  {selectedUser?.created_at
                    ? new Date(selectedUser.created_at).toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground">Roles</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {selectedUser &&
                    sortRoles(selectedUser.roles).map((r) => (
                      <Badge key={r} variant={roleBadgeVariant(r)}>
                        {r}
                      </Badge>
                    ))}
                </div>
              </div>
            </div>

            {selectedUser && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Shield className="h-4 w-4" />
                  Role Management
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Base role</span>
                  <Select
                    value={baseRoleOf(selectedUser.roles)}
                    onValueChange={(v) =>
                      handleSetBaseRole(selectedUser, v as BaseRole)
                    }
                    disabled={roleActionBusy}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Base role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="beta_tester">Beta Tester</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    Admin access
                  </span>
                  {selectedUser.roles.includes("admin") ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={
                        roleActionBusy || selectedUser.id === currentUserId
                      }
                      title={
                        selectedUser.id === currentUserId
                          ? "You cannot remove your own admin role"
                          : undefined
                      }
                      onClick={() => handleRemoveAdmin(selectedUser)}
                    >
                      Remove admin
                    </Button>
                  ) : confirmGrantAdmin ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={roleActionBusy}
                        onClick={() => setConfirmGrantAdmin(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={roleActionBusy}
                        onClick={() => handleGrantAdmin(selectedUser)}
                      >
                        Confirm grant admin?
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      disabled={roleActionBusy}
                      onClick={() => setConfirmGrantAdmin(true)}
                    >
                      <Shield className="h-4 w-4 mr-1" />
                      Grant admin
                    </Button>
                  )}
                </div>

                {selectedUser.id === currentUserId && (
                  <p className="text-xs text-muted-foreground">
                    This is your own account — you can change its base role, but
                    you cannot remove your own admin role.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetail(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
      <Footer />
    </div>
  );
};

export default AdminUsers;
