import Header from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAgentNetwork } from '@/hooks/useAgentNetwork';
import { MapPin, Phone, Clock, Search } from 'lucide-react';
import { useState } from 'react';

const AgentNetwork = () => {
  const { agents } = useAgentNetwork();
  const [search, setSearch] = useState('');

  const filtered = agents.data?.filter(a =>
    a.agent_name.toLowerCase().includes(search.toLowerCase()) ||
    a.city.toLowerCase().includes(search.toLowerCase()) ||
    a.location_name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Agent Network</h1>
        <p className="text-muted-foreground mb-6">Find nearby agents for cash-in and cash-out</p>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search by name, city, or location..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map(agent => (
            <Card key={agent.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold">{agent.agent_name}</p>
                    <p className="text-sm text-muted-foreground">{agent.location_name}</p>
                  </div>
                  <Badge variant="outline">{agent.agent_code}</Badge>
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {agent.address || agent.city}{agent.province ? `, ${agent.province}` : ''}</div>
                  {agent.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {agent.phone}</div>}
                  <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5" /> Daily limit: ZMW {Number(agent.daily_limit).toLocaleString()}</div>
                </div>
                <div className="flex gap-2 mt-3">
                  {agent.services?.map((s: string) => (
                    <Badge key={s} variant="secondary" className="text-xs">{s.replace('_', ' ')}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {!filtered.length && !agents.isLoading && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No agents found. Try a different search.</p>
          </CardContent></Card>
        )}
      </main>
    </div>
  );
};

export default AgentNetwork;
