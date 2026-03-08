import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { usePaymentRequests } from '@/hooks/usePaymentRequests';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Link2, Copy, Send, Clock, CheckCircle2, XCircle, Plus, Share2, QrCode } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const RequestMoney = () => {
  const { requests, isLoading, createRequest } = usePaymentRequests();
  const { formatAmount } = useCurrency();
  const { toast } = useToast();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount.', variant: 'destructive' });
      return;
    }
    if (!recipientEmail && !recipientPhone) {
      toast({ title: 'Error', description: 'Enter email or phone number.', variant: 'destructive' });
      return;
    }
    await createRequest.mutateAsync({
      amount: parseFloat(amount),
      recipient_email: recipientEmail || undefined,
      recipient_phone: recipientPhone || undefined,
      description: description || undefined,
    });
    setAmount('');
    setRecipientEmail('');
    setRecipientPhone('');
    setDescription('');
  };

  const copyPaymentLink = (code: string) => {
    const link = `${window.location.origin}/pay/${code}`;
    navigator.clipboard.writeText(link);
    toast({ title: 'Link copied!', description: 'Share this link with your recipient.' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-500/10 text-green-600 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Badge>;
      case 'expired': return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />Expired</Badge>;
      default: return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Request Money</h1>
          <p className="text-muted-foreground">Send payment requests or create shareable payment links</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Create Request */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />New Request</CardTitle>
              <CardDescription>Create a payment request or shareable link</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Amount (ZMW)</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} min="1" />
              </div>
              <div className="space-y-2">
                <Label>Recipient Email</Label>
                <Input type="email" placeholder="name@example.com" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Or Phone Number</Label>
                <Input placeholder="+260 XX XXX XXXX" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea placeholder="What's this for?" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={handleCreate} disabled={createRequest.isPending}>
                <Send className="h-4 w-4 mr-2" />
                {createRequest.isPending ? 'Creating...' : 'Create Request'}
              </Button>
            </CardFooter>
          </Card>

          {/* Requests List */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="pending">
              <TabsList className="mb-4">
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="paid">Paid</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>

              {['pending', 'paid', 'all'].map((tab) => (
                <TabsContent key={tab} value={tab}>
                  {isLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Card key={i} className="animate-pulse"><CardContent className="p-4"><div className="h-16 bg-muted rounded" /></CardContent></Card>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {requests
                        .filter((r) => tab === 'all' || r.status === tab)
                        .map((request) => (
                          <Card key={request.id} className="hover:shadow-md transition-shadow">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-1">
                                    <span className="font-bold text-lg">{formatAmount(request.amount)}</span>
                                    {getStatusBadge(request.status)}
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    To: {request.recipient_email || request.recipient_phone || 'Anyone with link'}
                                  </p>
                                  {request.description && (
                                    <p className="text-sm mt-1">{request.description}</p>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Created {format(new Date(request.created_at), 'MMM d, yyyy')}
                                    {request.expires_at && ` · Expires ${format(new Date(request.expires_at), 'MMM d')}`}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyPaymentLink(request.payment_link_code)}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const link = `${window.location.origin}/pay/${request.payment_link_code}`;
                                      if (navigator.share) {
                                        navigator.share({ title: 'Payment Request', text: request.description || 'Payment request', url: link });
                                      } else {
                                        copyPaymentLink(request.payment_link_code);
                                      }
                                    }}
                                  >
                                    <Share2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      {requests.filter((r) => tab === 'all' || r.status === tab).length === 0 && (
                        <Card>
                          <CardContent className="p-8 text-center text-muted-foreground">
                            <Link2 className="h-12 w-12 mx-auto mb-3 opacity-40" />
                            <p>No {tab === 'all' ? '' : tab} requests yet</p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default RequestMoney;
