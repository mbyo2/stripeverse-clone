
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { User, Shield, Bell, CreditCard, LogOut, Camera, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { CurrencySelector } from "@/components/CurrencySelector";
import { supabase } from "@/integrations/supabase/client";

const Settings = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);

  // Profile state
  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    avatar_url: ''
  });

  // Security state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  // Notification state
  const [notifications, setNotifications] = useState({
    email_transactions: true,
    email_marketing: false,
    email_security: true,
    email_news: false,
    push_enabled: false,
  });

  // Payment state
  const [payment, setPayment] = useState({
    transactionLimits: true,
    internationalPayments: false
  });

  // Fetch profile, notification prefs, and 2FA status
  useEffect(() => {
    if (!user?.id) return;

    const fetchAll = async () => {
      setProfileLoading(true);
      try {
        const [profileRes, notifRes, twoFaRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('two_factor_auth').select('enabled').eq('user_id', user.id).maybeSingle(),
        ]);

        if (profileRes.data) {
          setProfile({
            first_name: profileRes.data.first_name || '',
            last_name: profileRes.data.last_name || '',
            phone: profileRes.data.phone || '',
            avatar_url: profileRes.data.avatar_url || '',
          });
        }

        if (notifRes.data) {
          setNotifications({
            email_transactions: notifRes.data.email_transactions,
            email_marketing: notifRes.data.email_marketing,
            email_security: notifRes.data.email_security,
            email_news: notifRes.data.email_news,
            push_enabled: notifRes.data.push_enabled,
          });
        }

        if (twoFaRes.data) {
          setTwoFactorEnabled(twoFaRes.data.enabled);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      } finally {
        setProfileLoading(false);
      }
    };

    fetchAll();
  }, [user?.id]);

  const handleProfileUpdate = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone,
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({ title: "Profile Updated", description: "Your profile has been updated successfully." });
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotificationUpdate = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          ...notifications,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;

      toast({ title: "Notifications Updated", description: "Your notification preferences have been saved." });
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error) {
      toast({ title: "Logout Failed", description: "Failed to log out. Please try again.", variant: "destructive" });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/avatar.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const avatarUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setProfile(prev => ({ ...prev, avatar_url: avatarUrl }));
      toast({ title: "Avatar Updated", description: "Your profile photo has been updated." });
    } catch (error: any) {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-4xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your account settings and preferences</p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Security</span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">Notifications</span>
            </TabsTrigger>
            <TabsTrigger value="payment" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Payment</span>
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-6">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={profile.avatar_url} />
                    <AvatarFallback className="text-lg">
                      {profile.first_name?.[0]}{profile.last_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Label htmlFor="avatar-upload" className="cursor-pointer">
                      <Button variant="outline" className="flex items-center gap-2" asChild>
                        <span>
                          <Camera className="h-4 w-4" />
                          Change Photo
                        </span>
                      </Button>
                    </Label>
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={profile.first_name}
                      onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={profile.last_name}
                      onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email (Read-only)</Label>
                  <Input id="email" value={user?.email || ""} disabled className="bg-muted" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    placeholder="+260..."
                  />
                </div>

                <Button onClick={handleProfileUpdate} disabled={isLoading}>
                  {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</> : "Update Profile"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Two-Factor Authentication</h3>
                    <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={twoFactorEnabled ? "default" : "secondary"}>
                      {twoFactorEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => window.location.href = '/two-factor-auth'}>
                      {twoFactorEnabled ? "Manage" : "Set Up"}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Change Password</h3>
                    <p className="text-sm text-muted-foreground">Update your account password</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.location.href = '/reset-password'}>
                    Change
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Security Dashboard</h3>
                    <p className="text-sm text-muted-foreground">View login activity and security events</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.location.href = '/security-settings'}>
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Push Notifications</h3>
                    <p className="text-sm text-muted-foreground">Receive notifications on your device</p>
                  </div>
                  <Switch
                    checked={notifications.push_enabled}
                    onCheckedChange={(checked) => setNotifications({ ...notifications, push_enabled: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Transaction Emails</h3>
                    <p className="text-sm text-muted-foreground">Get notified about transactions via email</p>
                  </div>
                  <Switch
                    checked={notifications.email_transactions}
                    onCheckedChange={(checked) => setNotifications({ ...notifications, email_transactions: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Security Alerts</h3>
                    <p className="text-sm text-muted-foreground">Receive alerts about security events</p>
                  </div>
                  <Switch
                    checked={notifications.email_security}
                    onCheckedChange={(checked) => setNotifications({ ...notifications, email_security: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Marketing Emails</h3>
                    <p className="text-sm text-muted-foreground">Receive promotional content and updates</p>
                  </div>
                  <Switch
                    checked={notifications.email_marketing}
                    onCheckedChange={(checked) => setNotifications({ ...notifications, email_marketing: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">News & Updates</h3>
                    <p className="text-sm text-muted-foreground">Stay up to date with product news</p>
                  </div>
                  <Switch
                    checked={notifications.email_news}
                    onCheckedChange={(checked) => setNotifications({ ...notifications, email_news: checked })}
                  />
                </div>

                <Button onClick={handleNotificationUpdate} disabled={isLoading}>
                  {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Preferences"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payment Tab */}
          <TabsContent value="payment">
            <Card>
              <CardHeader>
                <CardTitle>Payment Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Default Currency</Label>
                  <CurrencySelector />
                  <p className="text-sm text-muted-foreground">
                    This currency will be used across the entire app
                  </p>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Transaction Limits</h3>
                    <p className="text-sm text-muted-foreground">Apply daily and monthly limits</p>
                  </div>
                  <Switch
                    checked={payment.transactionLimits}
                    onCheckedChange={(checked) => setPayment({ ...payment, transactionLimits: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">International Payments</h3>
                    <p className="text-sm text-muted-foreground">Allow payments outside Zambia</p>
                  </div>
                  <Switch
                    checked={payment.internationalPayments}
                    onCheckedChange={(checked) => setPayment({ ...payment, internationalPayments: checked })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="mt-6 border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Sign Out</h3>
                <p className="text-sm text-muted-foreground">Sign out from your account</p>
              </div>
              <Button variant="destructive" onClick={handleLogout} className="flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Settings;
