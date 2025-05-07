
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X } from "lucide-react";
import BetaBanner from "./BetaBanner";
import NotificationBell from "./notifications/NotificationBell";

const Header = () => {
  const location = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const navItems = [
    { title: "Home", path: "/" },
    { title: "About", path: "/about" },
    { title: "Services", path: "/services" },
    { title: "Pricing", path: "/pricing" },
    { title: "Contact", path: "/contact" },
  ];

  const userNavItems = [
    { title: "Dashboard", path: "/dashboard" },
    { title: "Wallet", path: "/wallet" },
    { title: "Transactions", path: "/transactions" },
    { title: "Send Money", path: "/send" },
  ];

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const headerClass = `fixed top-0 w-full z-40 transition-all duration-200 ${
    isScrolled ? "bg-background shadow-md" : "bg-transparent"
  }`;

  return (
    <>
      <BetaBanner />
      <header className={headerClass}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link to="/" className="text-2xl font-bold text-primary">
            BMaGlass Pay
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.title}
                to={item.path}
                className={`px-4 py-2 rounded-md transition-colors ${
                  isActive(item.path)
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center space-x-2">
            {user ? (
              <>
                <div className="flex items-center space-x-1">
                  {userNavItems.map((item) => (
                    <Link
                      key={item.title}
                      to={item.path}
                      className={`px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive(item.path)
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      {item.title}
                    </Link>
                  ))}
                  <NotificationBell />
                  <div className="ml-2 border-l pl-3">
                    <Link to="/profile">
                      <Button variant="outline" size="sm">
                        Profile
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => signOut()}
                      className="ml-2"
                    >
                      Logout
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="outline">Login</Button>
                </Link>
                <Link to="/register">
                  <Button>Sign Up</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Navigation Trigger */}
          <div className="md:hidden flex items-center">
            {user && <NotificationBell />}
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-2">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] sm:w-[400px]">
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between border-b pb-4">
                    <Link to="/" className="text-2xl font-bold text-primary" onClick={() => setIsOpen(false)}>
                      BMaGlass Pay
                    </Link>
                    <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
                      <X className="h-5 w-5" />
                      <span className="sr-only">Close</span>
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto py-4">
                    <nav className="flex flex-col space-y-1">
                      {navItems.map((item) => (
                        <Link
                          key={item.title}
                          to={item.path}
                          className={`px-4 py-3 rounded-md transition-colors ${
                            isActive(item.path)
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          }`}
                          onClick={() => setIsOpen(false)}
                        >
                          {item.title}
                        </Link>
                      ))}
                      {user && (
                        <>
                          <div className="h-px bg-border my-3" />
                          {userNavItems.map((item) => (
                            <Link
                              key={item.title}
                              to={item.path}
                              className={`px-4 py-3 rounded-md transition-colors ${
                                isActive(item.path)
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted"
                              }`}
                              onClick={() => setIsOpen(false)}
                            >
                              {item.title}
                            </Link>
                          ))}
                          <Link
                            to="/profile"
                            className={`px-4 py-3 rounded-md transition-colors ${
                              isActive("/profile")
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted"
                            }`}
                            onClick={() => setIsOpen(false)}
                          >
                            Profile
                          </Link>
                          <Link
                            to="/notifications"
                            className={`px-4 py-3 rounded-md transition-colors ${
                              isActive("/notifications")
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted"
                            }`}
                            onClick={() => setIsOpen(false)}
                          >
                            Notifications
                          </Link>
                        </>
                      )}
                    </nav>
                  </div>
                  <div className="border-t pt-4">
                    {user ? (
                      <div className="flex flex-col space-y-2">
                        <Button variant="outline" onClick={() => {
                          signOut();
                          setIsOpen(false);
                        }}>
                          Log Out
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col space-y-2">
                        <Link to="/login" className="w-full" onClick={() => setIsOpen(false)}>
                          <Button variant="outline" className="w-full">Login</Button>
                        </Link>
                        <Link to="/register" className="w-full" onClick={() => setIsOpen(false)}>
                          <Button className="w-full">Sign Up</Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
