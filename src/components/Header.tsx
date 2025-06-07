
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { RoleBadge } from "@/components/FeatureAccess";

const Header = () => {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <Link to="/" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            BMaGlass Pay
          </Link>
          
          {user && (
            <nav className="hidden md:flex items-center space-x-4">
              <Link to="/dashboard">
                <Button variant={isActive("/dashboard") ? "default" : "ghost"} size="sm">
                  Dashboard
                </Button>
              </Link>
              <Link to="/wallet">
                <Button variant={isActive("/wallet") ? "default" : "ghost"} size="sm">
                  Wallet
                </Button>
              </Link>
              <Link to="/transactions">
                <Button variant={isActive("/transactions") ? "default" : "ghost"} size="sm">
                  Transactions
                </Button>
              </Link>
              <Link to="/tier-management">
                <Button variant={isActive("/tier-management") ? "default" : "ghost"} size="sm">
                  Tiers
                </Button>
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {user ? (
            <>
              <RoleBadge />
              <RoleSwitcher />
              <Link to="/settings">
                <Button variant="ghost" size="sm">
                  Settings
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </>
          ) : (
            <div className="flex items-center space-x-2">
              <Link to="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link to="/register">
                <Button size="sm">
                  Get Started
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
