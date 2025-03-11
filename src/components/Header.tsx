import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from "@/lib/utils";
import { User, Wallet, ArrowUpRight, LineChart, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const { user, signOut } = useAuth();
  const isLoggedIn = !!user;
  
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setIsMobileMenuOpen(false);
  };

  const navItems = isLoggedIn 
    ? [
        { name: 'Dashboard', path: '/dashboard', icon: <LineChart className="w-4 h-4 mr-2" /> },
        { name: 'Send Money', path: '/transfer', icon: <ArrowUpRight className="w-4 h-4 mr-2" /> },
        { name: 'Wallet', path: '/wallet', icon: <Wallet className="w-4 h-4 mr-2" /> },
        { name: 'Transactions', path: '/transactions', icon: <LineChart className="w-4 h-4 mr-2" /> }
      ]
    : isHomePage
      ? [
          { name: 'Features', path: '#features', icon: null },
          { name: 'Products', path: '#products', icon: null },
          { name: 'Reviews', path: '#reviews', icon: null },
          { name: 'Contact', path: '#contact', icon: null }
        ]
      : [
          { name: 'Features', path: '/#features', icon: null },
          { name: 'Products', path: '/#products', icon: null },
          { name: 'Reviews', path: '/#reviews', icon: null },
          { name: 'Contact', path: '/#contact', icon: null }
        ];

  return (
    <header 
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-apple-ease w-full",
        isScrolled ? "py-3 bg-white/80 backdrop-blur-lg shadow-subtle" : "py-5 bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
        <Link to="/" className="text-2xl font-bold transition-opacity duration-300 hover:opacity-80">
          BMaGlass Pay
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-8">
          {navItems.map((item) => (
            <Link 
              key={item.name} 
              to={item.path}
              className="text-sm font-medium text-foreground/80 transition-colors duration-300 hover:text-foreground flex items-center"
            >
              {item.icon}
              {item.name}
            </Link>
          ))}
          
          {isLoggedIn ? (
            <button 
              className="button-primary text-sm flex items-center"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </button>
          ) : (
            <div className="flex items-center space-x-4">
              <Link to="/login" className="text-sm font-medium text-foreground/80 transition-colors duration-300 hover:text-foreground">
                Login
              </Link>
              <Link to="/register" className="button-primary text-sm">
                Sign Up
              </Link>
            </div>
          )}
        </nav>
        
        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden flex flex-col items-center justify-center w-10 h-10 rounded-full bg-secondary"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle Menu"
        >
          <span className={cn(
            "w-5 h-0.5 bg-foreground transition-all duration-300 ease-apple-ease",
            isMobileMenuOpen && "transform rotate-45 translate-y-1"
          )} />
          <span className={cn(
            "w-5 h-0.5 bg-foreground mt-1 transition-all duration-300 ease-apple-ease",
            isMobileMenuOpen && "opacity-0"
          )} />
          <span className={cn(
            "w-5 h-0.5 bg-foreground mt-1 transition-all duration-300 ease-apple-ease",
            isMobileMenuOpen && "transform -rotate-45 -translate-y-1"
          )} />
        </button>
      </div>
      
      {/* Mobile Menu */}
      <div className={cn(
        "md:hidden absolute w-full top-full left-0 bg-white/95 backdrop-blur-lg shadow-medium transition-all duration-500 ease-apple-ease overflow-hidden",
        isMobileMenuOpen ? "max-h-screen opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-4 py-4 space-y-4">
          {navItems.map((item) => (
            <Link 
              key={item.name} 
              to={item.path}
              className="block py-2 text-foreground/80 hover:text-foreground transition-colors duration-300 flex items-center"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {item.icon}
              {item.name}
            </Link>
          ))}
          
          {isLoggedIn ? (
            <button 
              className="button-primary w-full text-center flex items-center justify-center"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </button>
          ) : (
            <>
              <Link 
                to="/login" 
                className="block py-2 text-foreground/80 hover:text-foreground transition-colors duration-300"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Login
              </Link>
              <Link 
                to="/register" 
                className="button-primary w-full text-center"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
