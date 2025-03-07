
import { useState, useEffect } from 'react';
import { cn } from "@/lib/utils";

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <header 
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-apple-ease w-full",
        isScrolled ? "py-3 bg-white/80 backdrop-blur-lg shadow-subtle" : "py-5 bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
        <a href="#" className="text-2xl font-bold transition-opacity duration-300 hover:opacity-80">
          Essence
        </a>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-8">
          {['Products', 'Features', 'Reviews', 'Contact'].map((item) => (
            <a 
              key={item} 
              href={`#${item.toLowerCase()}`}
              className="text-sm font-medium text-foreground/80 transition-colors duration-300 hover:text-foreground"
            >
              {item}
            </a>
          ))}
          <button className="button-primary text-sm">
            Explore
          </button>
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
        isMobileMenuOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-4 py-4 space-y-4">
          {['Products', 'Features', 'Reviews', 'Contact'].map((item) => (
            <a 
              key={item} 
              href={`#${item.toLowerCase()}`}
              className="block py-2 text-foreground/80 hover:text-foreground transition-colors duration-300"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {item}
            </a>
          ))}
          <button className="button-primary w-full text-center">
            Explore
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
