import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const IpWhitelist = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newIp, setNewIp] = useState('');
  const [label, setLabel] = useState('');

  const ips = useQuery({
    queryKey: ['ip-whitelist', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('api_ip_whitelist').select('*').eq('user_id', user!.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addIp = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('api_ip_whitelist').insert({ user_id: user!.id, ip_address: newIp, label: label || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('IP added'); queryClient.invalidateQueries({ queryKey: ['ip-whitelist'] }); setNewIp(''); setLabel(''); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeIp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_ip_whitelist').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ip-whitelist'] }); },
  });

  const toggleIp = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('api_ip_whitelist').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ip-whitelist'] }); },
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">IP Whitelist</h1>
        <p className="text-muted-foreground mb-6">Restrict API access to specific IP addresses</p>

        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Add IP Address</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <div className="flex-1"><Input placeholder="e.g., 192.168.1.1" value={newIp} onChange={e => setNewIp(e.target.value)} /></div>
              <div className="flex-1"><Input placeholder="Label (optional)" value={label} onChange={e => setLabel(e.target.value)} /></div>
              <Button onClick={() => addIp.mutate()} disabled={!newIp}><Plus className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {ips.data?.map(ip => (
            <Card key={ip.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-mono text-sm">{ip.ip_address}</p>
                    {ip.label && <p className="text-xs text-muted-foreground">{ip.label}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={ip.is_active} onCheckedChange={v => toggleIp.mutate({ id: ip.id, is_active: v })} />
                  <Button size="icon" variant="ghost" onClick={() => removeIp.mutate(ip.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!ips.data?.length && <p className="text-center text-muted-foreground py-8">No IP addresses whitelisted. All IPs are currently allowed.</p>}
        </div>
      </main>
    </div>
  );
};

export default IpWhitelist;
