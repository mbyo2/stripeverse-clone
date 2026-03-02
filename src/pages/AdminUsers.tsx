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
  role?: string;
  email?: string;
}

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

  useEffect(() => {
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

      const roleMap = new Map<string, string>();
      rolesRes.data?.forEach((r) => roleMap.set(r.user_id, r.role));

      const enrichedUsers: UserRow[] = (profilesRes.data || []).map((p) => ({
        ...p,
        role: roleMap.get(p.id) || "user",
      }));

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
                          <Badge
                            variant={
                              u.role === "admin"
                                ? "destructive"
                                : u.role === "business"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {u.role}
                          </Badge>
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
        <Dialog open={showDetail} onOpenChange={setShowDetail}>
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
                <span className="text-muted-foreground">Role</span>
                <Badge>{selectedUser?.role}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joined</span>
                <span>
                  {selectedUser?.created_at
                    ? new Date(selectedUser.created_at).toLocaleString()
                    : "—"}
                </span>
              </div>
            </div>
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
