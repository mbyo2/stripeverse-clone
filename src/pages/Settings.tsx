
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { User, Shield, Bell, CreditCard, LogOut, Camera, Loader2, ChevronRight, Settings as SettingsIcon, Sun, Moon, Monitor, Palette } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { CurrencySelector } from "@/components/CurrencySelector";
import { supabase } from "@/integrations/supabase/client";

const Settings = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('profile');

  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    avatar_url: ''
  });

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const [notifications, setNotifications] = useState({
    email_transactions: true,
    email_marketing: false,
    email_security: true,
    email_news: false,
    push_enabled: false,
  });

  const [payment, setPayment] = useState({
    transactionLimits: true,
    internationalPayments: false
  });

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

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User, description: 'Personal information' },
    { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme & dark mode' },
    { id: 'security', label: 'Security', icon: Shield, description: 'Password & 2FA' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Email & push alerts' },
    { id: 'payment', label: 'Payment', icon: CreditCard, description: 'Currency & limits' },
  ];

  if (profileLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-muted/30">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-5xl mx-auto w-full flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-5xl mx-auto w-full">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <SettingsIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">Manage your account preferences</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
          {/* Sidebar nav */}
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeSection === item.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm">{item.label}</div>
                  <div className="text-xs text-muted-foreground hidden md:block">{item.description}</div>
                </div>
              </button>
            ))}

            <Separator className="my-3" />

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </nav>

          {/* Content area */}
          <div className="space-y-6">
            {/* Profile */}
            {activeSection === 'profile' && (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Profile Information</CardTitle>
                  <CardDescription>Update your personal details and profile photo</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-5">
                    <Avatar className="h-20 w-20 ring-2 ring-border">
                      <AvatarImage src={profile.avatar_url} />
                      <AvatarFallback className="text-lg bg-primary/10 text-primary font-semibold">
                        {profile.first_name?.[0]}{profile.last_name?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <Label htmlFor="avatar-upload" className="cursor-pointer">
                        <Button variant="outline" size="sm" className="gap-2" asChild>
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
                      <p className="text-xs text-muted-foreground mt-1">JPG, PNG. Max 2MB</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={profile.first_name}
                        onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                        className="h-11 rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={profile.last_name}
                        onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                        className="h-11 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" value={user?.email || ""} disabled className="h-11 rounded-lg bg-muted/50" />
                    <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      value={profile.phone}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      placeholder="+260..."
                      className="h-11 rounded-lg"
                    />
                  </div>

                  <div className="pt-2">
                    <Button onClick={handleProfileUpdate} disabled={isLoading} className="h-11 px-6 rounded-lg">
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Security */}
            {activeSection === 'security' && (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Security</CardTitle>
                  <CardDescription>Manage your security preferences and authentication</CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                  {[
                    {
                      title: 'Two-Factor Authentication',
                      desc: 'Add an extra layer of security to your account',
                      action: (
                        <div className="flex items-center gap-2">
                          <Badge variant={twoFactorEnabled ? "default" : "secondary"} className="text-xs">
                            {twoFactorEnabled ? "On" : "Off"}
                          </Badge>
                          <Button variant="ghost" size="sm" onClick={() => navigate('/two-factor-auth')}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      ),
                    },
                    {
                      title: 'Change Password',
                      desc: 'Update your account password regularly',
                      action: (
                        <Button variant="ghost" size="sm" onClick={() => navigate('/reset-password')}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      ),
                    },
                    {
                      title: 'Security Dashboard',
                      desc: 'Review login activity and security events',
                      action: (
                        <Button variant="ghost" size="sm" onClick={() => navigate('/security-settings')}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      ),
                    },
                  ].map((item, i, arr) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                          <p className="text-sm text-muted-foreground">{item.desc}</p>
                        </div>
                        {item.action}
                      </div>
                      {i < arr.length - 1 && <Separator />}
                    </React.Fragment>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Notifications */}
            {activeSection === 'notifications' && (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Notifications</CardTitle>
                  <CardDescription>Choose what you'd like to be notified about</CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                  {[
                    { key: 'push_enabled', title: 'Push Notifications', desc: 'Receive notifications on your device' },
                    { key: 'email_transactions', title: 'Transaction Emails', desc: 'Get notified about transactions' },
                    { key: 'email_security', title: 'Security Alerts', desc: 'Receive alerts about security events' },
                    { key: 'email_marketing', title: 'Marketing', desc: 'Promotional content and offers' },
                    { key: 'email_news', title: 'News & Updates', desc: 'Product news and feature updates' },
                  ].map((item, i, arr) => (
                    <React.Fragment key={item.key}>
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                          <p className="text-sm text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch
                          checked={(notifications as any)[item.key]}
                          onCheckedChange={(checked) =>
                            setNotifications({ ...notifications, [item.key]: checked })
                          }
                        />
                      </div>
                      {i < arr.length - 1 && <Separator />}
                    </React.Fragment>
                  ))}

                  <div className="pt-4">
                    <Button onClick={handleNotificationUpdate} disabled={isLoading} className="h-11 px-6 rounded-lg">
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Preferences"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment */}
            {activeSection === 'payment' && (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Payment Settings</CardTitle>
                  <CardDescription>Manage your currency and payment preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Default Currency</Label>
                    <CurrencySelector />
                    <p className="text-xs text-muted-foreground">Used across the entire app</p>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-foreground">Transaction Limits</h3>
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
                      <h3 className="text-sm font-medium text-foreground">International Payments</h3>
                      <p className="text-sm text-muted-foreground">Allow payments outside Zambia</p>
                    </div>
                    <Switch
                      checked={payment.internationalPayments}
                      onCheckedChange={(checked) => setPayment({ ...payment, internationalPayments: checked })}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Settings;
