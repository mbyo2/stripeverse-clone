import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Check, Inbox, X } from "lucide-react";
import {
  grantRole,
  isElevatedRole,
  listDirectoryUsers,
  roleChangeErrorMessage,
  roleLabel,
  type DirectoryUser,
} from "@/lib/adminConsole";
import { toUserFacingError } from "@/utils/userFacingError";
import type { Tables } from "@/integrations/supabase/types";

type RoleRequest = Tables<"role_requests">;

const statusVariant = (status: string) =>
  status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";

const AdminRoleRequests = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [directoryById, setDirectoryById] = useState<Map<string, DirectoryUser>>(new Map());
  const [heldRolesByUser, setHeldRolesByUser] = useState<Map<string, string[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [requestsRes, directory, rolesRes] = await Promise.all([
        supabase
          .from("role_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        listDirectoryUsers(supabase as never).catch(() => []),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (requestsRes.error) throw requestsRes.error;
      setRequests(requestsRes.data || []);

      const dirMap = new Map<string, DirectoryUser>();
      directory.forEach((d) =>
        dirMap.set(d.user_id, {
          id: d.user_id,
          email: d.email,
          first_name: d.first_name,
          last_name: d.last_name,
          phone: d.phone,
          created_at: d.created_at,
          roles: [],
          is_frozen: false,
        }),
      );
      setDirectoryById(dirMap);

      const held = new Map<string, string[]>();
      (rolesRes.data || []).forEach((r) => {
        const list = held.get(r.user_id) ?? [];
        list.push(r.role);
        held.set(r.user_id, list);
      });
      setHeldRolesByUser(held);
    } catch (err) {
      setLoadError(
        toUserFacingError(err, "We couldn't load role requests. Please try again."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    fetchData();
  }, [fetchData]);

  const requesterName = (userId: string) => {
    const d = directoryById.get(userId);
    const name = [d?.first_name, d?.last_name].filter(Boolean).join(" ");
    return name || d?.email || userId;
  };

  const markReviewed = async (req: RoleRequest, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("role_requests")
      .update({
        status,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    if (error) throw error;
  };

  const handleApprove = async (req: RoleRequest) => {
    setBusyId(req.id);
    try {
      const held = heldRolesByUser.get(req.user_id) ?? [];
      if (!held.includes(req.requested_role)) {
        // The grant itself is the supremacy gate: for an elevated role
        // the database refuses anyone who is not a super admin, and
        // that refusal is surfaced — the request stays pending.
        await grantRole(supabase as never, req.user_id, req.requested_role);
      }
      await markReviewed(req, "approved");
      toast({
        title: "Request approved",
        description: `${requesterName(req.user_id)} now holds the ${roleLabel(req.requested_role)} role.`,
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Couldn't approve that request",
        description: roleChangeErrorMessage(err, req.requested_role),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: RoleRequest) => {
    setBusyId(req.id);
    try {
      await markReviewed(req, "rejected");
      toast({
        title: "Request rejected",
        description: `The ${roleLabel(req.requested_role)} request from ${requesterName(req.user_id)} has been rejected.`,
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Couldn't reject that request",
        description: toUserFacingError(err, "We couldn't reject that request. Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const renderTable = (rows: RoleRequest[], showActions: boolean) => (
    <Table className="[&_td]:px-2 [&_th]:px-2 md:[&_td]:px-4 md:[&_th]:px-4">
      <TableHeader>
        <TableRow>
          <TableHead>Requester</TableHead>
          <TableHead>Requested role</TableHead>
          <TableHead className="hidden md:table-cell">Requested</TableHead>
          <TableHead>Status</TableHead>
          {showActions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((req) => (
          <TableRow key={req.id}>
            <TableCell className="max-w-[150px] font-medium md:max-w-none">
              {requesterName(req.user_id)}
              {directoryById.get(req.user_id)?.email && (
                <span className="block max-w-[104px] truncate text-xs font-normal text-muted-foreground md:max-w-none">
                  {directoryById.get(req.user_id)?.email}
                </span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={isElevatedRole(req.requested_role) ? "destructive" : "secondary"}>
                {roleLabel(req.requested_role)}
              </Badge>
            </TableCell>
            <TableCell className="hidden md:table-cell">{new Date(req.created_at).toLocaleDateString()}</TableCell>
            <TableCell>
              <Badge variant={statusVariant(req.status)}>{req.status}</Badge>
            </TableCell>
            {showActions && (
              <TableCell>
                <div className="flex flex-col gap-1.5 md:flex-row md:gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === req.id}
                    onClick={() => handleApprove(req)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === req.id}
                    onClick={() => handleReject(req)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={showActions ? 5 : 4} className="text-center text-muted-foreground py-8">
              {showActions ? "No pending requests" : "No reviewed requests yet"}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Inbox className="h-8 w-8" /> Role Requests
        </h1>
        <p className="text-muted-foreground mb-6">
          Requests users have submitted for a different role. Approving grants the
          role immediately and records you as the reviewer. Elevated roles (Admin,
          Super Admin and the per-feature admin roles) can only be approved by a
          super admin — the database enforces this, and a refusal will be explained
          rather than hidden.
        </p>

        {loadError ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-destructive mb-4">{loadError}</p>
              <Button variant="outline" onClick={fetchData}>Try again</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Pending ({pending.length})</CardTitle>
              </CardHeader>
              <CardContent>{renderTable(pending, true)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reviewed ({reviewed.length})</CardTitle>
              </CardHeader>
              <CardContent>{renderTable(reviewed, false)}</CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AdminRoleRequests;
