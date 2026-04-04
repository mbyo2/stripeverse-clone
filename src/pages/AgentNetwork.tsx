import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentNetwork } from '@/hooks/useAgentNetwork';
import { MapPin, Phone, Clock, Search, Navigation, List, Map } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const AgentNetwork = () => {
  const { agents } = useAgentNetwork();
  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const mapRef = useRef<HTMLDivElement>(null);

  const filtered = agents.data?.filter(a =>
    a.agent_name.toLowerCase().includes(search.toLowerCase()) ||
    a.city.toLowerCase().includes(search.toLowerCase()) ||
    a.location_name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  // Simple CSS-based map visualization
  const agentsWithCoords = filtered.filter(a => a.latitude && a.longitude);
  
  // Calculate bounds for mapping
  const latitudes = agentsWithCoords.map(a => a.latitude!);
  const longitudes = agentsWithCoords.map(a => a.longitude!);
  const minLat = Math.min(...latitudes, -16);
  const maxLat = Math.max(...latitudes, -12);
  const minLng = Math.min(...longitudes, 25);
  const maxLng = Math.max(...longitudes, 33);
  const latRange = maxLat - minLat || 4;
  const lngRange = maxLng - minLng || 8;

  const getAgentPosition = (lat: number, lng: number) => ({
    top: `${((maxLat - lat) / latRange) * 100}%`,
    left: `${((lng - minLng) / lngRange) * 100}%`,
  });

  const openInMaps = (lat: number, lng: number, name: string) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodeURIComponent(name)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Agent Network</h1>
            <p className="text-muted-foreground">Find nearby agents for cash-in and cash-out</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4 mr-1" /> List
            </Button>
            <Button
              variant={viewMode === 'map' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('map')}
            >
              <Map className="h-4 w-4 mr-1" /> Map
            </Button>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search by name, city, or location..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {viewMode === 'map' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map View */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    Agent Locations
                    <Badge variant="secondary" className="ml-2">{agentsWithCoords.length} on map</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    ref={mapRef}
                    className="relative w-full bg-muted/30 rounded-xl border-2 border-dashed border-border overflow-hidden"
                    style={{ height: '450px' }}
                  >
                    {/* Map background with Zambia outline approximation */}
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-primary/10" />
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/20">
                      <Map className="h-32 w-32" />
                    </div>

                    {/* Agent pins */}
                    {agentsWithCoords.map(agent => {
                      const pos = getAgentPosition(agent.latitude!, agent.longitude!);
                      const isSelected = selectedAgent === agent.id;
                      return (
                        <div
                          key={agent.id}
                          className="absolute transform -translate-x-1/2 -translate-y-full cursor-pointer z-10 group"
                          style={{ top: pos.top, left: pos.left }}
                          onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
                        >
                          <div className={`relative transition-transform ${isSelected ? 'scale-125' : 'group-hover:scale-110'}`}>
                            <MapPin className={`h-8 w-8 drop-shadow-md ${isSelected ? 'text-primary fill-primary/20' : 'text-destructive fill-destructive/20'}`} />
                          </div>
                          {/* Tooltip on hover/select */}
                          {isSelected && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-card rounded-lg shadow-lg border p-3 z-20">
                              <p className="font-semibold text-sm">{agent.agent_name}</p>
                              <p className="text-xs text-muted-foreground">{agent.location_name}</p>
                              <p className="text-xs text-muted-foreground mt-1">{agent.city}{agent.province ? `, ${agent.province}` : ''}</p>
                              {agent.phone && <p className="text-xs text-muted-foreground">{agent.phone}</p>}
                              <div className="flex gap-2 mt-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7"
                                  onClick={(e) => { e.stopPropagation(); openInMaps(agent.latitude!, agent.longitude!, agent.agent_name); }}
                                >
                                  <Navigation className="h-3 w-3 mr-1" /> Directions
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {agentsWithCoords.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-muted-foreground text-sm">No agents with coordinates found</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Side list */}
            <div className="space-y-3 max-h-[520px] overflow-y-auto">
              {filtered.map(agent => (
                <Card
                  key={agent.id}
                  className={`cursor-pointer transition-colors ${selectedAgent === agent.id ? 'border-primary' : ''}`}
                  onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                >
                  <CardContent className="p-3">
                    <p className="font-semibold text-sm">{agent.agent_name}</p>
                    <p className="text-xs text-muted-foreground">{agent.location_name} · {agent.city}</p>
                    {agent.latitude && agent.longitude && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-6 mt-1 p-0 text-primary"
                        onClick={(e) => { e.stopPropagation(); openInMaps(agent.latitude!, agent.longitude!, agent.agent_name); }}
                      >
                        <Navigation className="h-3 w-3 mr-1" /> Get Directions
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          /* List View */
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
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex gap-2 flex-1">
                      {agent.services?.map((s: string) => (
                        <Badge key={s} variant="secondary" className="text-xs">{s.replace('_', ' ')}</Badge>
                      ))}
                    </div>
                    {agent.latitude && agent.longitude && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs shrink-0"
                        onClick={() => openInMaps(agent.latitude!, agent.longitude!, agent.agent_name)}
                      >
                        <Navigation className="h-3 w-3 mr-1" /> Directions
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!filtered.length && !agents.isLoading && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No agents found. Try a different search.</p>
          </CardContent></Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AgentNetwork;
