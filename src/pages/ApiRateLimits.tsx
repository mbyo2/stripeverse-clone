import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Gauge, Clock, AlertTriangle, Shield } from "lucide-react";
import PageSkeleton from "@/components/PageSkeleton";
import PageErrorState from "@/components/PageErrorState";
import EmptyState from "@/components/ui/empty-state";
import { format } from "date-fns";

const ApiRateLimits = () => {
  const { user } = useAuth();

  const { data: rateLimits, isLoading, error, refetch } = useQuery({
    queryKey: ["rate-limits", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rate_limits")
        .select("*")
        .eq("identifier", user!.id)
        .order("window_start", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const actionLimits: Record<string, number> = {
    login: 10,
    transfer: 50,
    api_call: 1000,
    webhook: 500,
    payment: 100,
  };

  if (isLoading) return <PageSkeleton cards={3} />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Gauge className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">API Rate Limits</h1>
            <p className="text-sm text-muted-foreground">Monitor your API usage and rate limits</p>
          </div>
        </div>

        {error ? (
          <PageErrorState onRetry={refetch} />
        ) : !rateLimits || rateLimits.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Gauge className="h-12 w-12" />}
                title="No rate limit data"
                description="API rate limit data will appear here as you use the API."
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {Object.entries(
                rateLimits.reduce((acc: Record<string, number>, rl) => {
                  acc[rl.action] = (acc[rl.action] || 0) + rl.attempts;
                  return acc;
                }, {})
              )
                .slice(0, 3)
                .map(([action, total]) => {
                  const limit = actionLimits[action] || 100;
                  const pct = Math.min(100, ((total as number) / limit) * 100);
                  return (
                    <Card key={action}>
                      <CardContent className="pt-5 pb-5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium capitalize">{action.replace(/_/g, " ")}</span>
                          <Badge variant={pct > 80 ? "destructive" : "secondary"}>
                            {total}/{limit}
                          </Badge>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </CardContent>
                    </Card>
                  );
                })}
            </div>

            {/* Detailed Log */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Rate Limit Log</CardTitle>
                <CardDescription>Recent rate limit windows</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {rateLimits.map((rl) => {
                    const limit = actionLimits[rl.action] || 100;
                    const pct = (rl.attempts / limit) * 100;
                    return (
                      <div key={rl.id} className="px-6 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {pct > 80 ? (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          ) : (
                            <Shield className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="text-sm font-medium capitalize">{rl.action.replace(/_/g, " ")}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(rl.window_start), "MMM d, HH:mm")} · {rl.attempts} attempts
                            </p>
                          </div>
                        </div>
                        <Progress value={Math.min(100, pct)} className="w-24 h-2" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default ApiRateLimits;
