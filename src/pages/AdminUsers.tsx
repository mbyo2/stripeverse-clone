import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Search, UserCheck, UserX, Eye, Snowflake } from "lucide-react";
import {
  directoryUserMatchesSearch,
  listDirectoryUsers,
  mergeDirectoryUsers,
  roleLabel,
  sortRolesForDisplay,
  type DirectoryUser,
} from "@/lib/adminConsole";
import { toUserFacingError } from "@/utils/userFacingError";

const roleBadgeVariant = (role: string) =>
  role === "super_admin" || role === "admin"
    ? "destructive"
    : role === "business"
      ? "default"
      : "secondary";

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
  const navigate = useNavigate();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [kycRequests, setKycRequests] = useState<KycRow[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("all");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // The directory comes from admin_list_users() — the only client
      // path that can see user emails. Roles and frozen flags are
      // joined client-side from their own tables.
      const [directoryRows, rolesRes, frozenRes, kycRes] = await Promise.all([
        listDirectoryUsers(supabase as never),
        supabase.from("user_roles").select("user_id, role"),
        (supabase as any)
          .from("profiles")
          .select("id, is_frozen"),
        supabase
          .from("kyc_verifications")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      setUsers(
        mergeDirectoryUsers(
          directoryRows,
          (rolesRes.data || []) as { user_id: string; role: string }[],
          (frozenRes.data || []) as { id: string; is_frozen: boolean | null }[],
        ),
      );
      setKycRequests((kycRes.data || []) as KycRow[]);
    } catch (err) {
      console.error(err);
      toast({
        title: "Couldn't load users",
        description: toUserFacingError(err, "We couldn't load the user list. Please try again."),
        variant: "destructive",
      });
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

  const filteredUsers = users.filter((u) => {
    const matchesSearch = directoryUserMatchesSearch(u, search);
    const matchesRole = roleFilter === "all" || u.roles.includes(roleFilter);
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
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">User Management</h1>
        <p className="text-muted-foreground mb-6">
          Manage users, review KYC submissions, and oversee account activity.
          Open a user to see their full account, freeze or unfreeze it, and
          manage their roles.
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
                      placeholder="Search by name, email, or phone..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Filter role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="beta_tester">Beta Tester</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                      <SelectItem value="p2p_admin">P2P Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <span>
                              {u.first_name || ""} {u.last_name || ""}
                              {!u.first_name && !u.last_name && (
                                <span className="text-muted-foreground italic">No name</span>
                              )}
                            </span>
                            {u.is_frozen && (
                              <Badge variant="destructive" className="text-xs">
                                <Snowflake className="h-3 w-3 mr-1" />
                                Frozen
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{u.email || "—"}</TableCell>
                        <TableCell>{u.phone || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {sortRolesForDisplay(u.roles).map((r) => (
                              <Badge key={r} variant={roleBadgeVariant(r)}>
                                {roleLabel(r)}
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
                            title={`View ${u.first_name || "user"}'s full account`}
                            onClick={() => navigate(`/admin/users/${u.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
      </main>
      <Footer />
    </div>
  );
};

export default AdminUsers;
