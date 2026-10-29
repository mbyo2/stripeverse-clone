import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import GlobalSearch from "@/components/GlobalSearch";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { headerMenuVisibility } from "@/lib/roleVisibility";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { RoleBadge } from "@/components/FeatureAccess";
import { CurrencySelector } from "@/components/CurrencySelector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronDown,
  AlertCircle,
  BarChart3, 
  Settings, 
  HelpCircle, 
  Star, 
  Menu,
  Home,
  Wallet,
  ArrowLeftRight,
  CreditCard as CardIcon,
  Users,
  FileText,
  Phone,
  BookOpen,
  DollarSign,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Shield,
  Layers,
  Sun,
  Moon,
  Globe,
  Bell,
  Code2,
  Clock,
  Building2,
  Link2,
  GitBranch,
  Coins,
  FileSpreadsheet,
  RotateCcw,
  Banknote,
  Zap,
  Package,
  ShieldCheck,
  Receipt,
  CalendarClock,
  Lock,
  MapPin,
  Search,
  Store,
  Bitcoin
} from "lucide-react";
import { isAuthPending } from "@/lib/sessionHint";
import { SkeletonHeaderBar } from "@/components/ui/skeletons";
import NotificationBell from "@/components/notifications/NotificationBell";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AccountSwitcherList } from "@/components/AccountSwitcher";
import Logo from "@/components/Logo";

const Header = () => {
  const { user, signOut, isAuthReady, hasStoredSession } = useAuth();
  const { roles } = useRoles();
  // Role visibility (CEO directive 2026-10-25): menu entries that
  // belong to a role the user doesn't hold are not rendered at all —
  // an admin-console destination never appears in a plain user's
  // menus, and a business surface never appears for non-business
  // users. The one model in roleVisibility.ts decides all four
  // role-owned entries, including Fraud Rules in the account menus:
  // it belongs to business holders AND the admin tier its route
  // gate admits, so the super_admin owner (no business role row)
  // sees it too. Presentation only; the routes and the database
  // enforce the real rules underneath.
  const menuVisibility = headerMenuVisibility(roles);
  const showAdminLinks = menuVisibility.adminLinks;
  const showFraudRules = menuVisibility.fraudRules;
  const location = useLocation();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // While a stored session is still resolving, hold the signed-in
  // header twin instead of painting the guest chrome (Log In / Sign
  // Up pills, public nav) the session would flip a few frames later
  // — the visible half of the 2026-10-29 wrong-page flash on public
  // pages that don't redirect (pricing, about, …). Resolved guests
  // and resolved users render the real header exactly as before.
  if (isAuthPending({ user, isAuthReady, hasStoredSession })) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50">
        <SkeletonHeaderBar variant="authed" />
      </div>
    );
  }

  const MobileNavLink = ({ to, icon: Icon, children }: { to: string; icon: React.ElementType; children: React.ReactNode }) => (
    <Link 
      to={to} 
      onClick={closeMobileMenu}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
        isActive(to) ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </Link>
  );

  return (
    <>
    <header className="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-[#0A0F1A] border-b border-[#CFD3D8]/70 dark:border-white/10">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-3">
        {/* Logo */}
        <div className="flex items-center gap-3 xl:gap-6 2xl:gap-10 min-w-0">
          <Link to="/" aria-label="BMaGlass Pay — home" className="flex items-center shrink-0">
            <Logo variant={resolvedTheme === "dark" ? "white" : "color"} />
          </Link>

          {/* Logged-out Nav */}
          {!user && (
            <nav className="hidden xl:flex items-center gap-8">
              <Link to="/" className="text-[15px] font-medium text-black dark:text-white hover:underline underline-offset-4">
                Personal
              </Link>
              <Link to="/business" className="text-[15px] font-medium text-black dark:text-white hover:underline underline-offset-4">
                Business
              </Link>
              <Link to="/developers" className="text-[15px] font-medium text-black dark:text-white hover:underline underline-offset-4">
                Developers
              </Link>
            </nav>
          )}

          {/* Desktop Nav */}
          {user && (
            <nav className="hidden xl:flex items-center gap-1 min-w-0">
              <Link to="/dashboard">
                <Button variant={isActive("/dashboard") ? "default" : "ghost"} size="sm" className="text-sm font-medium h-9 px-3 2xl:px-4">
                  Dashboard
                </Button>
              </Link>
              {/* The Bitcoin wallet is the product — first destination after
                  Dashboard, styled as the primary action in Bitcoin orange. */}
              <Link to="/bitcoin-wallet">
                <Button
                  size="sm"
                  className={`h-9 rounded-full px-3.5 2xl:px-4 text-sm font-semibold text-black shadow-none gap-1.5 ${
                    isActive("/bitcoin-wallet") ? "bg-[#DE830A]" : "bg-[#F7931A] hover:bg-[#DE830A]"
                  }`}
                >
                  <Bitcoin className="h-4 w-4" /> Bitcoin Wallet
                </Button>
              </Link>
              <Link to="/p2p">
                <Button variant={isActive("/p2p") ? "default" : "ghost"} size="sm" className="text-sm font-medium h-9 px-3 2xl:px-4">
                  P2P Trading
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1 px-3 2xl:px-4">
                    Send & Request <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link to="/transfer" className="flex items-center gap-2">
                      <ArrowLeftRight className="h-4 w-4" /> Transfer Money
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/send-money" className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" /> Send Money
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/request-money" className="flex items-center gap-2">
                      <Globe className="h-4 w-4" /> Request Money
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/bank-transfers" className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" /> Bank Transfers
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/bulk-payments" className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" /> Bulk Payments
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/contacts" className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> Contacts
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/scheduled-payments" className="flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Scheduled Payments
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/qr-payments" className="flex items-center gap-2">
                      <Globe className="h-4 w-4" /> QR Payments
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1 px-3 2xl:px-4">
                    Wallet <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link to="/bitcoin-wallet" className="flex items-center gap-2">
                      <Bitcoin className="h-4 w-4 text-[#F7931A]" /> Bitcoin Wallet
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/wallet" className="flex items-center gap-2">
                      <Wallet className="h-4 w-4" /> My Wallet
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/multi-currency" className="flex items-center gap-2">
                      <Coins className="h-4 w-4" /> Multi-Currency
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/sub-accounts" className="flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Sub-accounts
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/transactions" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Transactions
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/card/new" className="flex items-center gap-2">
                      <CardIcon className="h-4 w-4" /> Virtual Cards
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/spending-insights" className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Spending Insights
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/refunds" className="flex items-center gap-2">
                      <RotateCcw className="h-4 w-4" /> Refunds
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/card-vault" className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" /> Card Vault
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/pay-later" className="flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Buy Now Pay Later
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/savings" className="flex items-center gap-2">
                      <Star className="h-4 w-4" /> Savings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/statements" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Statements
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/transaction-search" className="flex items-center gap-2">
                      <Globe className="h-4 w-4" /> Search Transactions
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1 px-3 2xl:px-4">
                    Business <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link to="/business" className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> Business Tools
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/collect-payments" className="flex items-center gap-2">
                      <Banknote className="h-4 w-4" /> Collect Payments
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/payment-links" className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" /> Payment Links
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/pos" className="flex items-center gap-2">
                      <Store className="h-4 w-4" /> Bitcoin POS
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/split-payments" className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4" /> Split Payments
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/invoices" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Invoices
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/analytics" className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Analytics
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settlements" className="flex items-center gap-2">
                      <Receipt className="h-4 w-4" /> Settlements
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/disputes" className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" /> Disputes
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/webhook-logs" className="flex items-center gap-2">
                      <Zap className="h-4 w-4" /> Webhook Logs
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/api" className="flex items-center gap-2">
                      <Code2 className="h-4 w-4" /> API Management
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/billing" className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" /> Billing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/payment-plans" className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4" /> Payment Plans
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/escrow" className="flex items-center gap-2">
                      <Lock className="h-4 w-4" /> Escrow
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/bill-payments" className="flex items-center gap-2">
                      <Zap className="h-4 w-4" /> Bill Payments
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/agent-network" className="flex items-center gap-2">
                      <Globe className="h-4 w-4" /> Agent Network
                    </Link>
                  </DropdownMenuItem>
                  {showFraudRules && (
                  <DropdownMenuItem asChild>
                    <Link to="/fraud-rules" className="flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Fraud Rules
                    </Link>
                  </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/ip-whitelist" className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" /> IP Whitelist
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/checkout-widget" className="flex items-center gap-2">
                      <Code2 className="h-4 w-4" /> Checkout Widget
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/developers" className="flex items-center gap-2">
                      <Code2 className="h-4 w-4" /> Developers
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          )}
        </div>

        {/* Right Side */}
        <div className="hidden xl:flex items-center gap-2 shrink-0">
          {user ? (
            <>
              {/* Width budget: the 1320px container leaves 1232px at 1280 and
                  1272px at ≥1366 for the whole row. The account switcher,
                  language/currency selectors and role badge live in the
                  avatar menu (below) so the row fits at every width ≥1280. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchOpen(true)}
                className="hidden 2xl:flex h-9 gap-2 text-muted-foreground font-normal w-32 justify-start"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="text-xs">Search...</span>
                <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchOpen(true)}
                className="h-9 w-9 2xl:hidden"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </Button>
              <NotificationBell />

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-9 w-9"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-1">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {/* Account hub: switcher, role and display preferences moved
                      here from the header row (see width budget above). */}
                  <div className="px-2 pt-1.5 pb-1">
                    <RoleBadge />
                  </div>
                  <AccountSwitcherList />
                  <div className="px-2 py-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Language</span>
                      <LanguageSelector compact />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Currency</span>
                      <CurrencySelector compact />
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/security-settings" className="flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Security
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/rewards" className="flex items-center gap-2">
                      <Star className="h-4 w-4" /> Rewards
                    </Link>
                  </DropdownMenuItem>
                  {showAdminLinks && (
                  <DropdownMenuItem asChild>
                    <Link to="/tier-management" className="flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Subscription
                    </Link>
                  </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/role-management" className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> Role Management
                    </Link>
                  </DropdownMenuItem>
                  {showAdminLinks && (
                  <>
                  <DropdownMenuItem asChild>
                    <Link to="/audit-logs" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Audit Logs
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/backup-export" className="flex items-center gap-2">
                      <Package className="h-4 w-4" /> Backup & Export
                    </Link>
                  </DropdownMenuItem>
                  </>
                  )}
                  {showFraudRules && (
                  <DropdownMenuItem asChild>
                    <Link to="/fraud-rules" className="flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Fraud Rules
                    </Link>
                  </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/support" className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4" /> Help & Support
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="text-destructive">
                    <LogOut className="h-4 w-4 mr-2" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link to="/support" className="hidden xl:block text-[15px] font-medium text-black dark:text-white hover:underline underline-offset-4 mr-1">
                Help
              </Link>
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-10 w-10 rounded-full" aria-label="Toggle theme">
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Link to="/login">
                <Button variant="ghost" className="h-12 rounded-full bg-[#E9EEF5] px-7 text-[15px] font-semibold text-[#003087] shadow-none hover:bg-[#DBE5F1] hover:text-[#003087]">
                  Log In
                </Button>
              </Link>
              <Link to="/register">
                <Button className="h-12 rounded-full bg-black px-7 text-[15px] font-semibold text-white shadow-none hover:bg-black/85">
                  Sign Up
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Menu */}
        <div className="xl:hidden flex items-center gap-2 shrink-0">
          {user && <NotificationBell />}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-80 p-0 gap-0 flex flex-col overflow-hidden">
              <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
                <SheetTitle className="text-left pr-8">
                  <Logo variant={resolvedTheme === "dark" ? "white" : "color"} />
                </SheetTitle>
              </SheetHeader>

              <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
              <div className="mt-2 space-y-1">
                {user ? (
                  <>
                    <div className="px-4 py-3 mb-2">
                      <RoleBadge />
                    </div>

                    <AccountSwitcherList onNavigate={closeMobileMenu} />

                    <Separator className="my-2" />
                    <MobileNavLink to="/dashboard" icon={Home}>Dashboard</MobileNavLink>
                    {/* The main product, first in the drawer with Bitcoin-orange weight. */}
                    <Link
                      to="/bitcoin-wallet"
                      onClick={closeMobileMenu}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-semibold ${
                        isActive("/bitcoin-wallet")
                          ? "bg-[#F7931A] text-black"
                          : "bg-[#F7931A]/15 text-foreground hover:bg-[#F7931A]/25"
                      }`}
                    >
                      <Bitcoin className={`h-4 w-4 ${isActive("/bitcoin-wallet") ? "text-black" : "text-[#F7931A]"}`} />
                      <span>Bitcoin Wallet</span>
                    </Link>
                    <MobileNavLink to="/p2p" icon={ArrowLeftRight}>P2P Trading</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Money</p>
                    <MobileNavLink to="/wallet" icon={Wallet}>Wallet</MobileNavLink>
                    <MobileNavLink to="/multi-currency" icon={Coins}>Multi-Currency</MobileNavLink>
                    <MobileNavLink to="/sub-accounts" icon={Layers}>Sub-accounts</MobileNavLink>
                    <MobileNavLink to="/transactions" icon={FileText}>Transactions</MobileNavLink>
                    <MobileNavLink to="/transfer" icon={ArrowLeftRight}>Transfer</MobileNavLink>
                    <MobileNavLink to="/send-money" icon={DollarSign}>Send Money</MobileNavLink>
                    <MobileNavLink to="/request-money" icon={Globe}>Request Money</MobileNavLink>
                    <MobileNavLink to="/bank-transfers" icon={Building2}>Bank Transfers</MobileNavLink>
                    <MobileNavLink to="/bulk-payments" icon={FileSpreadsheet}>Bulk Payments</MobileNavLink>
                    <MobileNavLink to="/contacts" icon={Users}>Contacts</MobileNavLink>
                    <MobileNavLink to="/card/new" icon={CardIcon}>Virtual Cards</MobileNavLink>
                    <MobileNavLink to="/spending-insights" icon={BarChart3}>Spending Insights</MobileNavLink>
                    <MobileNavLink to="/refunds" icon={RotateCcw}>Refunds</MobileNavLink>
                    <MobileNavLink to="/card-vault" icon={ShieldCheck}>Card Vault</MobileNavLink>
                    <MobileNavLink to="/pay-later" icon={Layers}>Buy Now Pay Later</MobileNavLink>
                    <MobileNavLink to="/scheduled-payments" icon={Clock}>Scheduled Payments</MobileNavLink>
                    <MobileNavLink to="/qr-payments" icon={Globe}>QR Payments</MobileNavLink>
                    <MobileNavLink to="/savings" icon={Star}>Savings</MobileNavLink>
                    <MobileNavLink to="/statements" icon={FileText}>Statements</MobileNavLink>
                    <MobileNavLink to="/transaction-search" icon={Globe}>Search Transactions</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Business</p>
                    <MobileNavLink to="/business" icon={Users}>Business Tools</MobileNavLink>
                    <MobileNavLink to="/collect-payments" icon={Banknote}>Collect Payments</MobileNavLink>
                    <MobileNavLink to="/payment-links" icon={Link2}>Payment Links</MobileNavLink>
                    <MobileNavLink to="/pos" icon={Store}>Bitcoin POS</MobileNavLink>
                    <MobileNavLink to="/split-payments" icon={GitBranch}>Split Payments</MobileNavLink>
                    <MobileNavLink to="/invoices" icon={FileText}>Invoices</MobileNavLink>
                    <MobileNavLink to="/settlements" icon={Receipt}>Settlements</MobileNavLink>
                    <MobileNavLink to="/disputes" icon={AlertCircle}>Disputes</MobileNavLink>
                    <MobileNavLink to="/webhook-logs" icon={Zap}>Webhook Logs</MobileNavLink>
                    <MobileNavLink to="/analytics" icon={BarChart3}>Analytics</MobileNavLink>
                    <MobileNavLink to="/api" icon={Code2}>API</MobileNavLink>
                    <MobileNavLink to="/sdk-docs" icon={Package}>SDK Docs</MobileNavLink>
                    <MobileNavLink to="/billing" icon={DollarSign}>Billing</MobileNavLink>
                    <MobileNavLink to="/payment-plans" icon={CalendarClock}>Payment Plans</MobileNavLink>
                    <MobileNavLink to="/escrow" icon={Lock}>Escrow</MobileNavLink>
                    <MobileNavLink to="/bill-payments" icon={Zap}>Bill Payments</MobileNavLink>
                    <MobileNavLink to="/agent-network" icon={MapPin}>Agent Network</MobileNavLink>
                    {showFraudRules && <MobileNavLink to="/fraud-rules" icon={Shield}>Fraud Rules</MobileNavLink>}
                    <MobileNavLink to="/ip-whitelist" icon={ShieldCheck}>IP Whitelist</MobileNavLink>
                    <MobileNavLink to="/checkout-widget" icon={Code2}>Checkout Widget</MobileNavLink>
                    <MobileNavLink to="/developers" icon={Code2}>Developers</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account</p>
                    <MobileNavLink to="/rewards" icon={Star}>Rewards</MobileNavLink>
                    {showAdminLinks && <MobileNavLink to="/tier-management" icon={Layers}>Tier Limits</MobileNavLink>}
                    <MobileNavLink to="/role-management" icon={Users}>Role Management</MobileNavLink>
                    <MobileNavLink to="/settings" icon={Settings}>Settings</MobileNavLink>
                    <MobileNavLink to="/security-settings" icon={Shield}>Security</MobileNavLink>
                    {showAdminLinks && <MobileNavLink to="/audit-logs" icon={FileText}>Audit Logs</MobileNavLink>}
                    {showAdminLinks && <MobileNavLink to="/backup-export" icon={Package}>Backup & Export</MobileNavLink>}
                    {showFraudRules && <MobileNavLink to="/fraud-rules" icon={Shield}>Fraud Rules</MobileNavLink>}
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Preferences</p>
                    <div className="px-4 py-2">
                      <CurrencySelector />
                    </div>
                    <div className="px-4 py-2">
                      <LanguageSelector />
                    </div>

                    <button 
                      onClick={toggleTheme}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left hover:bg-muted transition-colors text-sm font-medium"
                    >
                      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>

                    <Separator className="my-2" />
                    <MobileNavLink to="/support" icon={HelpCircle}>Help & Support</MobileNavLink>
                    <MobileNavLink to="/faq" icon={BookOpen}>FAQ</MobileNavLink>
                  </>
                ) : (
                  <>
                    <MobileNavLink to="/" icon={Home}>Home</MobileNavLink>
                    <MobileNavLink to="/bitcoin-wallet" icon={Bitcoin}>Bitcoin Wallet</MobileNavLink>
                    <MobileNavLink to="/about" icon={Users}>About</MobileNavLink>
                    <MobileNavLink to="/pricing" icon={DollarSign}>Pricing</MobileNavLink>
                    <MobileNavLink to="/developers" icon={Code2}>Developers</MobileNavLink>
                    <MobileNavLink to="/faq" icon={HelpCircle}>FAQ</MobileNavLink>
                    <MobileNavLink to="/contact" icon={Phone}>Contact</MobileNavLink>
                    
                    <Separator className="my-4" />
                    <button 
                      onClick={toggleTheme}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left hover:bg-muted transition-colors text-sm font-medium"
                    >
                      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                  </>
                )}
              </div>
              </div>

              {/* Pinned footer — Sign Out (or Log In / Sign Up) is always
                  visible at the bottom of the drawer, no scrolling needed. */}
              <div className="shrink-0 border-t border-border bg-background px-6 py-4">
                {user ? (
                  <button
                    onClick={() => { signOut(); closeMobileMenu(); }}
                    className="flex items-center justify-center gap-2 w-full h-12 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/15 transition-colors text-[15px] font-semibold"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <Link to="/login" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full gap-2 rounded-full h-12 bg-[#E9EEF5] text-[15px] font-semibold text-[#003087] shadow-none hover:bg-[#DBE5F1] hover:text-[#003087]">
                        <LogIn className="h-4 w-4" /> Log In
                      </Button>
                    </Link>
                    <Link to="/register" onClick={closeMobileMenu}>
                      <Button className="w-full gap-2 rounded-full h-12 bg-black text-[15px] font-semibold text-white shadow-none hover:bg-black/85">
                        <UserPlus className="h-4 w-4" /> Sign Up
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
    {/* The header is fixed, so it contributes no layout height. This in-flow
        spacer reserves exactly the header's height (72px) at the top of
        every page that renders <Header />, so page content — back buttons,
        titles, everything — starts below the header at rest and scrolls
        under it. This is the ONLY header offset in the app: pages must not
        add their own pt- compensation for the header. */}
    <div aria-hidden="true" className="h-[72px] shrink-0" />
    <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
};

export default Header;
