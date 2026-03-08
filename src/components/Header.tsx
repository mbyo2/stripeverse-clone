import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
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
  CreditCard,
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
  Shield as ShieldIcon,
  Receipt
} from "lucide-react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { LanguageSelector } from "@/components/LanguageSelector";

const Header = () => {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

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
    <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border shadow-subtle">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg paypal-gradient flex items-center justify-center">
              <CreditCard className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground">BMaGlass<span className="text-primary">Pay</span></span>
          </Link>
          
          {/* Desktop Nav */}
          {user && (
            <nav className="hidden lg:flex items-center gap-1">
              <Link to="/dashboard">
                <Button variant={isActive("/dashboard") ? "default" : "ghost"} size="sm" className="text-sm font-medium h-9">
                  Dashboard
                </Button>
              </Link>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1">
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
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1">
                    Wallet <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
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
                      <ShieldIcon className="h-4 w-4" /> Card Vault
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/buy-now-pay-later" className="flex items-center gap-2">
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
                  <Button variant="ghost" size="sm" className="text-sm font-medium h-9 gap-1">
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
                    <Link to="/sub-accounts" className="flex items-center gap-2">
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
                </DropdownMenuContent>
              </DropdownMenu>

              <Link to="/developers">
                <Button variant={isActive("/developers") ? "default" : "ghost"} size="sm" className="text-sm font-medium h-9">
                  Developers
                </Button>
              </Link>
            </nav>
          )}
        </div>

        {/* Right Side */}
        <div className="hidden lg:flex items-center gap-2">
          {user ? (
            <>
              <CurrencySelector compact />
              <NotificationBell />
              <RoleBadge />
              
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
                <DropdownMenuContent align="end" className="w-52">
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
                  <DropdownMenuItem asChild>
                    <Link to="/tier-management" className="flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Subscription
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/role-management" className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> Role Management
                    </Link>
                  </DropdownMenuItem>
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
            <div className="flex items-center gap-2">
              <Link to="/about"><Button variant="ghost" size="sm" className="text-sm h-9">About</Button></Link>
              <Link to="/pricing"><Button variant="ghost" size="sm" className="text-sm h-9">Pricing</Button></Link>
              <Link to="/developers"><Button variant="ghost" size="sm" className="text-sm h-9">Developers</Button></Link>
              <Link to="/contact"><Button variant="ghost" size="sm" className="text-sm h-9">Contact</Button></Link>
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9" aria-label="Toggle theme">
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Separator orientation="vertical" className="h-6" />
              <Link to="/login"><Button variant="ghost" size="sm" className="text-sm h-9">Log In</Button></Link>
              <Link to="/register"><Button size="sm" className="text-sm h-9 rounded-full px-5">Sign Up Free</Button></Link>
            </div>
          )}
        </div>

        {/* Mobile Menu */}
        <div className="lg:hidden flex items-center gap-2">
          {user && <NotificationBell />}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="text-left flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg paypal-gradient flex items-center justify-center">
                    <CreditCard className="h-3.5 w-3.5 text-white" />
                  </div>
                  BMaGlass<span className="text-primary">Pay</span>
                </SheetTitle>
              </SheetHeader>
              
              <div className="mt-6 space-y-1">
                {user ? (
                  <>
                    <div className="px-4 py-3 mb-2">
                      <RoleBadge />
                    </div>
                    
                    <Separator className="my-2" />
                    <MobileNavLink to="/dashboard" icon={Home}>Dashboard</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Money</p>
                    <MobileNavLink to="/wallet" icon={Wallet}>Wallet</MobileNavLink>
                    <MobileNavLink to="/multi-currency" icon={Coins}>Multi-Currency</MobileNavLink>
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
                    <MobileNavLink to="/card-vault" icon={ShieldIcon}>Card Vault</MobileNavLink>
                    <MobileNavLink to="/buy-now-pay-later" icon={Layers}>Buy Now Pay Later</MobileNavLink>
                    <MobileNavLink to="/scheduled-payments" icon={Clock}>Scheduled Payments</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Business</p>
                    <MobileNavLink to="/business" icon={Users}>Business Tools</MobileNavLink>
                    <MobileNavLink to="/collect-payments" icon={Banknote}>Collect Payments</MobileNavLink>
                    <MobileNavLink to="/payment-links" icon={Link2}>Payment Links</MobileNavLink>
                    <MobileNavLink to="/sub-accounts" icon={GitBranch}>Split Payments</MobileNavLink>
                    <MobileNavLink to="/invoices" icon={FileText}>Invoices</MobileNavLink>
                    <MobileNavLink to="/settlements" icon={Receipt}>Settlements</MobileNavLink>
                    <MobileNavLink to="/disputes" icon={AlertCircle}>Disputes</MobileNavLink>
                    <MobileNavLink to="/webhook-logs" icon={Zap}>Webhook Logs</MobileNavLink>
                    <MobileNavLink to="/analytics" icon={BarChart3}>Analytics</MobileNavLink>
                    <MobileNavLink to="/api" icon={Code2}>API</MobileNavLink>
                    <MobileNavLink to="/sdk-docs" icon={Package}>SDK Docs</MobileNavLink>
                    <MobileNavLink to="/billing" icon={DollarSign}>Billing</MobileNavLink>
                    <MobileNavLink to="/developers" icon={Code2}>Developers</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account</p>
                    <MobileNavLink to="/rewards" icon={Star}>Rewards</MobileNavLink>
                    <MobileNavLink to="/tier-management" icon={Layers}>Subscription</MobileNavLink>
                    <MobileNavLink to="/settings" icon={Settings}>Settings</MobileNavLink>
                    <MobileNavLink to="/security-settings" icon={Shield}>Security</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Preferences</p>
                    <div className="px-4 py-2">
                      <CurrencySelector />
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
                    
                    <Separator className="my-2" />
                    <button 
                      onClick={() => { signOut(); closeMobileMenu(); }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left text-destructive hover:bg-destructive/10 transition-colors text-sm font-medium"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <>
                    <MobileNavLink to="/" icon={Home}>Home</MobileNavLink>
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
                    
                    <Separator className="my-4" />
                    <div className="px-4 space-y-3">
                      <Link to="/login" onClick={closeMobileMenu}>
                        <Button variant="outline" className="w-full gap-2">
                          <LogIn className="h-4 w-4" /> Log In
                        </Button>
                      </Link>
                      <Link to="/register" onClick={closeMobileMenu}>
                        <Button className="w-full gap-2 rounded-full">
                          <UserPlus className="h-4 w-4" /> Sign Up Free
                        </Button>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};

export default Header;
