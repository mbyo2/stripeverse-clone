
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { RoleBadge } from "@/components/FeatureAccess";
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
  Moon
} from "lucide-react";

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
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        isActive(to) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      }`}
    >
      <Icon className="h-5 w-5" />
      <span>{children}</span>
    </Link>
  );

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <Link to="/" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            BMaGlass Pay
          </Link>
          
          {user && (
            <nav className="hidden lg:flex items-center space-x-2">
              <Link to="/dashboard">
                <Button variant={isActive("/dashboard") ? "default" : "ghost"} size="sm">
                  Dashboard
                </Button>
              </Link>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-1">
                    Payments <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-background border shadow-lg">
                  <DropdownMenuItem asChild>
                    <Link to="/wallet" className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      Wallet
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/transactions">Transactions</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/transfer">Transfer Money</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/card/new">Virtual Cards</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-1">
                    Business <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-background border shadow-lg">
                  <DropdownMenuItem asChild>
                    <Link to="/analytics" className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Analytics
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/api">API Management</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/billing">Billing</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/business">Business Tools</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Link to="/rewards">
                <Button variant={isActive("/rewards") ? "default" : "ghost"} size="sm" className="flex items-center gap-1">
                  <Star className="h-4 w-4" />
                  Rewards
                </Button>
              </Link>

              <Link to="/tier-management">
                <Button variant={isActive("/tier-management") ? "default" : "ghost"} size="sm">
                  Tiers
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-1">
                    <HelpCircle className="h-4 w-4" />
                    Help <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-background border shadow-lg">
                  <DropdownMenuItem asChild>
                    <Link to="/support">Support Center</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/help">Help & FAQ</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/faq">FAQ</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/contact">Contact Us</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          )}
        </div>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center space-x-4">
          {user ? (
            <>
              <RoleBadge />
              <RoleSwitcher />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-1">
                    <Settings className="h-4 w-4" />
                    Account <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-background border shadow-lg">
                  <DropdownMenuItem asChild>
                    <Link to="/profile">Profile</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings">Settings</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/role-management">Role Management</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center space-x-2">
              <Link to="/about">
                <Button variant="ghost" size="sm">About</Button>
              </Link>
              <Link to="/blog">
                <Button variant="ghost" size="sm">Blog</Button>
              </Link>
              <Link to="/pricing">
                <Button variant="ghost" size="sm">Pricing</Button>
              </Link>
              <Link to="/contact">
                <Button variant="ghost" size="sm">Contact</Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
              <Link to="/login">
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link to="/register">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
          )}

          {/* Theme toggle for authenticated users */}
          {user && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="hidden lg:flex"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="lg:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="text-left bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  BMaGlass Pay
                </SheetTitle>
              </SheetHeader>
              
              <div className="mt-6 space-y-1">
                {user ? (
                  <>
                    {/* User Info */}
                    <div className="px-4 py-3 mb-4">
                      <RoleBadge />
                    </div>
                    
                    <Separator className="my-2" />
                    
                    {/* Main Navigation */}
                    <MobileNavLink to="/dashboard" icon={Home}>Dashboard</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-sm font-medium text-muted-foreground">Payments</p>
                    
                    <MobileNavLink to="/wallet" icon={Wallet}>Wallet</MobileNavLink>
                    <MobileNavLink to="/transactions" icon={FileText}>Transactions</MobileNavLink>
                    <MobileNavLink to="/transfer" icon={ArrowLeftRight}>Transfer Money</MobileNavLink>
                    <MobileNavLink to="/send-money" icon={DollarSign}>Send Money</MobileNavLink>
                    <MobileNavLink to="/card/new" icon={CardIcon}>Virtual Cards</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-sm font-medium text-muted-foreground">Business</p>
                    
                    <MobileNavLink to="/analytics" icon={BarChart3}>Analytics</MobileNavLink>
                    <MobileNavLink to="/api" icon={FileText}>API Management</MobileNavLink>
                    <MobileNavLink to="/billing" icon={DollarSign}>Billing</MobileNavLink>
                    <MobileNavLink to="/business" icon={Users}>Business Tools</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-sm font-medium text-muted-foreground">More</p>
                    
                    <MobileNavLink to="/rewards" icon={Star}>Rewards</MobileNavLink>
                    <MobileNavLink to="/tier-management" icon={Layers}>Tiers</MobileNavLink>
                    <MobileNavLink to="/notifications" icon={HelpCircle}>Notifications</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-sm font-medium text-muted-foreground">Help & Support</p>
                    
                    <MobileNavLink to="/support" icon={HelpCircle}>Support Center</MobileNavLink>
                    <MobileNavLink to="/faq" icon={BookOpen}>FAQ</MobileNavLink>
                    <MobileNavLink to="/contact" icon={Phone}>Contact Us</MobileNavLink>
                    
                    <Separator className="my-2" />
                    <p className="px-4 py-2 text-sm font-medium text-muted-foreground">Account</p>
                    
                    <MobileNavLink to="/profile" icon={User}>Profile</MobileNavLink>
                    <MobileNavLink to="/settings" icon={Settings}>Settings</MobileNavLink>
                    <MobileNavLink to="/security-settings" icon={Shield}>Security</MobileNavLink>
                    
                    <Separator className="my-2" />

                    {/* Theme Toggle */}
                    <button 
                      onClick={toggleTheme}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left hover:bg-muted transition-colors"
                    >
                      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                    
                    <button 
                      onClick={() => { signOut(); closeMobileMenu(); }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut className="h-5 w-5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Public Navigation */}
                    <MobileNavLink to="/" icon={Home}>Home</MobileNavLink>
                    <MobileNavLink to="/about" icon={Users}>About Us</MobileNavLink>
                    <MobileNavLink to="/blog" icon={BookOpen}>Blog</MobileNavLink>
                    <MobileNavLink to="/pricing" icon={DollarSign}>Pricing</MobileNavLink>
                    <MobileNavLink to="/faq" icon={HelpCircle}>FAQ</MobileNavLink>
                    <MobileNavLink to="/contact" icon={Phone}>Contact</MobileNavLink>
                    
                    <Separator className="my-4" />

                    {/* Theme Toggle */}
                    <button 
                      onClick={toggleTheme}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left hover:bg-muted transition-colors"
                    >
                      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                    
                    <Separator className="my-4" />
                    
                    <div className="px-4 space-y-3">
                      <Link to="/login" onClick={closeMobileMenu}>
                        <Button variant="outline" className="w-full justify-start gap-2">
                          <LogIn className="h-4 w-4" />
                          Sign In
                        </Button>
                      </Link>
                      <Link to="/register" onClick={closeMobileMenu}>
                        <Button className="w-full justify-start gap-2">
                          <UserPlus className="h-4 w-4" />
                          Get Started
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
