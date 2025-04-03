
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, User, LogOut, HelpCircle, Shield, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";

const Header = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [headerBg, setHeaderBg] = useState('bg-transparent');
  const headerRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const { toast } = useToast();
  const user = auth?.user || null;

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setHeaderBg('bg-background/90 backdrop-blur-sm');
      } else {
        setHeaderBg('bg-transparent');
      }
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    setIsOpen(false); // Close the menu when the route changes
  }, [location.pathname]);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      if (auth?.signOut) {
        await auth.signOut();
        toast({
          title: "Logged out",
          description: "You have been successfully logged out.",
        });
        navigate('/login');
      }
    } catch (error) {
      console.error("Logout failed:", error);
      toast({
        title: "Logout failed",
        description: "There was an error logging you out. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <header 
      ref={headerRef}
      className={`fixed top-0 left-0 w-full z-50 ${headerBg}`}
    >
      <div className="px-4 py-3 md:py-4 max-w-7xl mx-auto flex justify-between items-center">
        <Link 
          to="/" 
          className="text-lg md:text-2xl font-bold text-primary"
        >
          BMaGlass Pay
        </Link>
        
        <button 
          onClick={toggleMenu} 
          className="lg:hidden text-primary focus:outline-none"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        
        <div className={`${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed top-0 left-0 h-screen lg:h-auto lg:static w-full max-w-xs lg:max-w-none lg:w-auto bg-background lg:bg-transparent py-8 lg:py-0 flex flex-col lg:flex-row lg:items-center gap-4 transition-transform duration-300 ease-in-out z-20 shadow-xl lg:shadow-none overflow-y-auto`}>
          <button 
            onClick={closeMenu} 
            className="absolute top-4 right-4 lg:hidden text-primary focus:outline-none"
          >
            <X className="h-6 w-6" />
          </button>
          
          <nav className="space-y-4 lg:space-y-0 lg:space-x-6 lg:flex px-8 lg:px-0 mt-8 lg:mt-0">
            <Link 
              to="/"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              Home
            </Link>
            
            <Link 
              to="/payment-services"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              Payment Services
            </Link>
            
            <Link 
              to="/wallet"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              Wallet
            </Link>
            
            <Link 
              to="/business-dashboard"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              <Building2 className="h-4 w-4 inline-block mr-1" />
              Business
            </Link>
            
            <Link 
              to="/faq"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              <HelpCircle className="h-4 w-4 inline-block mr-1" />
              FAQ
            </Link>
            
            <Link 
              to="/compliance"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              <Shield className="h-4 w-4 inline-block mr-1" />
              Compliance
            </Link>
            
            <Link 
              to="/contact"
              className="block hover:text-primary transition-colors duration-300"
              onClick={closeMenu}
            >
              Contact
            </Link>
          </nav>
          
          <div className="lg:ml-auto px-8 lg:px-0 flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-4">
                <button 
                  onClick={handleLogout} 
                  className="flex items-center text-red-500 hover:text-red-700 transition-colors duration-300"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </button>
                <Link 
                  to="/profile"
                  className="flex items-center text-primary hover:text-primary-foreground transition-colors duration-300"
                  onClick={closeMenu}
                >
                  <User className="h-4 w-4 mr-2" />
                  Profile
                </Link>
              </div>
            ) : (
              <>
                <Link 
                  to="/login" 
                  className="hidden md:block py-2 px-4 text-sm font-medium rounded-md hover:bg-secondary transition-colors duration-300"
                  onClick={closeMenu}
                >
                  Log In
                </Link>
                <Link 
                  to="/register" 
                  className="py-2 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/80 transition-colors duration-300"
                  onClick={closeMenu}
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
        
        {isOpen && (
          <div className="fixed top-0 left-0 w-full h-full bg-black/50 z-10 lg:hidden" onClick={closeMenu}></div>
        )}
      </div>
    </header>
  );
};

export default Header;
