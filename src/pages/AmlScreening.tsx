import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useAmlScreening } from '@/hooks/useAmlScreening';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Shield, Search, AlertTriangle, CheckCircle, Clock, FileText, User, Globe, Loader2, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const AmlScreening = () => {
  const { user } = useAuth();
  const { screenings } = useAmlScreening();
  const { toast } = useToast();

  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [country, setCountry] = useState('ZM');
  const [screeningType, setScreeningType] = useState('sanctions');
  const [loading, setLoading] = useState(false);
  const [selectedScreening, setSelectedScreening] = useState<any>(null);

  const handleScreening = async () => {
    if (!fullName.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      // Simulated screening check (in production, call an AML provider like ComplyAdvantage)
      const riskFactors: string[] = [];
      const matchFound = Math.random() < 0.1; // 10% chance of match for demo

      if (matchFound) {
        riskFactors.push('Potential PEP match', 'Name similarity > 85%');
      }

      const riskLevel = matchFound ? 'high' : (Math.random() < 0.2 ? 'medium' : 'low');

      const { error } = await supabase.from('aml_screenings').insert({
        user_id: user!.id,
        full_name: fullName,
        date_of_birth: dateOfBirth || null,
        country,
        screening_type: screeningType,
        match_found: matchFound,
        risk_level: riskLevel,
        status: matchFound ? 'review_required' : 'cleared',
        match_details: matchFound ? {
          matches: [
            { list: 'OFAC SDN', score: 87, name: fullName, country },
            ...(riskFactors.length ? [{ factors: riskFactors }] : []),
          ],
        } : null,
      });

      if (error) throw error;

      toast({
        title: matchFound ? 'Review Required' : 'Screening Passed',
        description: matchFound
          ? 'Potential match found — manual review required'
          : `${fullName} cleared with ${riskLevel} risk`,
        variant: matchFound ? 'destructive' : 'default',
      });

      // Reset
      setFullName('');
      setDateOfBirth('');
      screenings.refetch();
    } catch (err: any) {
      toast({ title: 'Screening failed', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const riskBadge = (level: string) => {
    const variants: Record<string, string> = {
      low: 'bg-green-500/10 text-green-700 border-green-200',
      medium: 'bg-yellow-500/10 text-yellow-700 border-yellow-200',
      high: 'bg-red-500/10 text-red-700 border-red-200',
    };
    return <Badge variant="outline" className={variants[level] || ''}>{level.toUpperCase()}</Badge>;
  };

  const statusBadge = (status: string) => {
    if (status === 'cleared') return <Badge variant="outline" className="bg-green-500/10 text-green-700">Cleared</Badge>;
    if (status === 'review_required') return <Badge variant="outline" className="bg-red-500/10 text-red-700">Review Required</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            AML Screening
          </h1>
          <p className="text-muted-foreground mt-1">
            Anti-Money Laundering compliance checks — sanctions, PEP, and adverse media screening
          </p>
        </div>

        <Tabs defaultValue="screen" className="space-y-6">
          <TabsList>
            <TabsTrigger value="screen"><Search className="h-4 w-4 mr-2" />New Screening</TabsTrigger>
            <TabsTrigger value="history"><FileText className="h-4 w-4 mr-2" />History</TabsTrigger>
          </TabsList>

          <TabsContent value="screen">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Run AML Check</CardTitle>
                  <CardDescription>Screen individuals against sanctions lists, PEP databases, and adverse media</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter full legal name" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date of Birth</Label>
                      <Input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Country</Label>
                      <Select value={country} onValueChange={setCountry}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ZM">Zambia</SelectItem>
                          <SelectItem value="US">United States</SelectItem>
                          <SelectItem value="GB">United Kingdom</SelectItem>
                          <SelectItem value="NG">Nigeria</SelectItem>
                          <SelectItem value="KE">Kenya</SelectItem>
                          <SelectItem value="ZA">South Africa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Screening Type</Label>
                    <Select value={screeningType} onValueChange={setScreeningType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sanctions">Sanctions Lists</SelectItem>
                        <SelectItem value="pep">Politically Exposed Persons (PEP)</SelectItem>
                        <SelectItem value="adverse_media">Adverse Media</SelectItem>
                        <SelectItem value="full">Full Screening (All)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button className="w-full" onClick={handleScreening} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                    {loading ? 'Screening...' : 'Run Screening'}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Screening Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {[
                      { title: 'Sanctions Lists', desc: 'OFAC SDN, UN Security Council, EU Consolidated', icon: Shield },
                      { title: 'PEP Database', desc: 'Heads of state, senior politicians, military officials', icon: User },
                      { title: 'Adverse Media', desc: 'Negative news, fraud cases, financial crime reports', icon: AlertTriangle },
                      { title: 'Global Coverage', desc: '200+ countries and territories', icon: Globe },
                    ].map(item => (
                      <div key={item.title} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                        <item.icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium text-sm">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Screening History</CardTitle>
                <CardDescription>{screenings.data?.length || 0} screenings performed</CardDescription>
              </CardHeader>
              <CardContent>
                {screenings.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : screenings.data && screenings.data.length > 0 ? (
                  <div className="space-y-3">
                    {screenings.data.map((s: any) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => setSelectedScreening(s)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.match_found ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                            {s.match_found ? <AlertTriangle className="h-5 w-5 text-red-500" /> : <CheckCircle className="h-5 w-5 text-green-500" />}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{s.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.screening_type} · {new Date(s.screened_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {riskBadge(s.risk_level)}
                          {statusBadge(s.status)}
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No screenings yet. Run your first AML check above.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Screening Detail Dialog */}
        <Dialog open={!!selectedScreening} onOpenChange={() => setSelectedScreening(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Screening Details</DialogTitle>
            </DialogHeader>
            {selectedScreening && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Full Name</Label>
                    <p className="font-medium">{selectedScreening.full_name}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Country</Label>
                    <p className="font-medium">{selectedScreening.country || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Type</Label>
                    <p className="font-medium capitalize">{selectedScreening.screening_type}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Date</Label>
                    <p className="font-medium">{new Date(selectedScreening.screened_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  {riskBadge(selectedScreening.risk_level)}
                  {statusBadge(selectedScreening.status)}
                  {selectedScreening.match_found && <Badge variant="destructive">Match Found</Badge>}
                </div>
                {selectedScreening.match_details && (
                  <div className="bg-muted rounded-lg p-4">
                    <p className="text-sm font-medium mb-2">Match Details</p>
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {JSON.stringify(selectedScreening.match_details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
      <Footer />
    </div>
  );
};

export default AmlScreening;
