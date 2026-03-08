import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { Star, StarOff, UserPlus, Phone, Mail, Search, Trash2, Send, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const Contacts = () => {
  const { contacts, favorites, isLoading, addContact, toggleFavorite, deleteContact } = useSavedContacts();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const handleAdd = async () => {
    if (!newName) return;
    await addContact.mutateAsync({
      contact_name: newName,
      phone_number: newPhone || undefined,
      email: newEmail || undefined,
    });
    setShowAdd(false);
    setNewName('');
    setNewPhone('');
    setNewEmail('');
  };

  const filtered = contacts.filter(
    (c) =>
      c.contact_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone_number?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Contacts</h1>
            <p className="text-muted-foreground">Manage your saved recipients for quick payments</p>
          </div>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button><UserPlus className="h-4 w-4 mr-2" />Add Contact</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Contact</DialogTitle>
                <DialogDescription>Save a recipient for quick future payments</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input placeholder="Contact name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input placeholder="+260 XX XXX XXXX" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" placeholder="name@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button onClick={handleAdd} disabled={!newName || addContact.isPending}>
                  {addContact.isPending ? 'Saving...' : 'Save Contact'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" /> Favorites
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {favorites.map((contact) => (
                <Card
                  key={contact.id}
                  className="text-center hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate('/send-money')}
                >
                  <CardContent className="p-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2 text-lg font-bold">
                      {contact.contact_name.charAt(0).toUpperCase()}
                    </div>
                    <p className="font-medium text-sm truncate">{contact.contact_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{contact.phone_number || contact.email}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* All Contacts */}
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-4"><div className="h-12 bg-muted rounded" /></CardContent></Card>
            ))
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <UserPlus className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>{search ? 'No contacts match your search' : 'No saved contacts yet'}</p>
                <Button className="mt-4" onClick={() => setShowAdd(true)}>Add Your First Contact</Button>
              </CardContent>
            </Card>
          ) : (
            filtered.map((contact) => (
              <Card key={contact.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {contact.contact_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{contact.contact_name}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        {contact.phone_number && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contact.phone_number}</span>}
                        {contact.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contact.email}</span>}
                      </div>
                      {contact.transaction_count > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">{contact.transaction_count} transactions</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleFavorite.mutate({ id: contact.id, is_favorite: !contact.is_favorite })}
                    >
                      {contact.is_favorite ? (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      ) : (
                        <StarOff className="h-4 w-4" />
                      )}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => navigate('/send-money')}>
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteContact.mutate(contact.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Contacts;
