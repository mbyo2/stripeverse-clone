import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AUTH_RATE_LIMIT_ATTEMPTS, AUTH_RATE_LIMIT_WINDOW_MINUTES } from "@/contexts/AuthContext";
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

  // Denominators come only from real enforcement sources — never invented:
  //  - auth actions (login, signup, …): the attempt limits AuthContext
  //    passes to the check_advanced_rate_limit RPC;
  //  - api_call: the user's plan limit from the tier_limits table
  //    (api_calls_per_hour), the same table subscription billing reads.
  // Any other action has no configured per-action limit, so only its
  // attempt count is shown.
  const { data: apiCallLimit } = useQuery({
    queryKey: ["api-call-limit", user?.id],
    queryFn: async (): Promise<number | null> => {
      const { data: sub } = await supabase
        .from("subscribers")
        .select("subscription_tier")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (!sub?.subscription_tier) return null;
      const { data: tier } = await supabase
        .from("tier_limits")
        .select("api_calls_per_hour")
        .eq("tier", sub.subscription_tier)
        .maybeSingle();
      return tier?.api_calls_per_hour ?? null;
    },
    enabled: !!user,
  });

  const limitFor = (action: string): number | undefined =>
    AUTH_RATE_LIMIT_ATTEMPTS[action] ??
    (action === "api_call" ? apiCallLimit ?? undefined : undefined);

  if (isLoading) return <PageSkeleton cards={3} />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-6xl mx-auto w-full">
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
                  const limit = limitFor(action);
                  const pct = limit ? Math.min(100, ((total as number) / limit) * 100) : null;
                  return (
                    <Card key={action}>
                      <CardContent className="pt-5 pb-5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium capitalize">{action.replace(/_/g, " ")}</span>
                          {limit ? (
                            <Badge variant={pct! > 80 ? "destructive" : "secondary"}>
                              {total}/{limit}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">{total} attempts</Badge>
                          )}
                        </div>
                        {limit ? (
                          <Progress value={pct!} className="h-2" />
                        ) : (
                          <p className="text-xs text-muted-foreground">No fixed per-action limit is configured for this action.</p>
                        )}
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
                    const limit = limitFor(rl.action);
                    const pct = limit ? (rl.attempts / limit) * 100 : null;
                    return (
                      <div key={rl.id} className="px-6 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {pct !== null && pct > 80 ? (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          ) : (
                            <Shield className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="text-sm font-medium capitalize">{rl.action.replace(/_/g, " ")}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(rl.window_start), "MMM d, HH:mm")} · {rl.attempts} attempts{limit ? ` of ${limit}` : ""}
                            </p>
                          </div>
                        </div>
                        {pct !== null && <Progress value={Math.min(100, pct)} className="w-24 h-2" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-muted-foreground mt-6">
          Limits shown are the enforced ones: sign-in and sign-up limits ({AUTH_RATE_LIMIT_ATTEMPTS.login} and {AUTH_RATE_LIMIT_ATTEMPTS.signup} attempts per {AUTH_RATE_LIMIT_WINDOW_MINUTES} minutes) come from the app's rate-limit checks, and the API-call limit is your plan's hourly limit from the tier settings. Actions without a configured limit show attempts only.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default ApiRateLimits;
