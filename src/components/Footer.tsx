
import { useEffect, useRef } from 'react';

const Footer = () => {
  const footerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          footerRef.current?.classList.add('animate-fadeIn');
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (footerRef.current) {
      observer.observe(footerRef.current);
    }
    
    return () => {
      if (footerRef.current) {
        observer.unobserve(footerRef.current);
      }
    };
  }, []);

  const currentYear = new Date().getFullYear();

  return (
    <footer 
      ref={footerRef}
      className="py-12 px-4 bg-primary text-primary-foreground opacity-0"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="col-span-1 md:col-span-2">
            <div className="text-2xl font-bold mb-4">Essence</div>
            <p className="text-primary-foreground/80 max-w-md">
              Creating thoughtfully designed products that elevate the everyday experience through simplicity and attention to detail.
            </p>
          </div>
          
          <div>
            <h4 className="text-base font-medium mb-4">Pages</h4>
            <ul className="space-y-2">
              {['Products', 'Features', 'Reviews', 'Contact'].map((item) => (
                <li key={item}>
                  <a 
                    href={`#${item.toLowerCase()}`}
                    className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          
          <div>
            <h4 className="text-base font-medium mb-4">Connect</h4>
            <ul className="space-y-2">
              {['Instagram', 'Twitter', 'LinkedIn', 'Facebook'].map((item) => (
                <li key={item}>
                  <a 
                    href="#"
                    className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-6 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center">
          <p className="text-primary-foreground/60 text-sm">
            &copy; {currentYear} Essence Design. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex items-center space-x-6">
            <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300">
              Privacy Policy
            </a>
            <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300">
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
