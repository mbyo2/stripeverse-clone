
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Smartphone, Phone, Mail, MapPin, Shield, Globe } from 'lucide-react';

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
      className="py-12 px-4 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green text-white opacity-0"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10">
          <div className="col-span-1 md:col-span-2">
            <div className="text-2xl font-bold mb-4">BMaGlass Pay</div>
            <p className="text-primary-foreground/80 max-w-md">
              Founded by Mabvuto Banda in Lusaka, BMaGlass Pay is Zambia's trusted payment gateway solution, serving businesses of all sizes with secure and efficient digital payment processing.
            </p>
            
            <div className="mt-6 flex items-center space-x-4">
              <Shield className="h-5 w-5 text-primary-foreground/80" />
              <Link to="/compliance" className="text-primary-foreground/80 hover:text-primary-foreground transition-colors">
                PCI DSS Compliant
              </Link>
            </div>
            <div className="mt-2 flex items-center space-x-4">
              <Globe className="h-5 w-5 text-primary-foreground/80" />
              <Link to="/compliance" className="text-primary-foreground/80 hover:text-primary-foreground transition-colors">
                Bank of Zambia Approved
              </Link>
            </div>
          </div>

          <div>
            <h4 className="text-base font-medium mb-4">Company</h4>
            <ul className="space-y-2">
              <li>
                <Link 
                  to="/about"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link 
                  to="/blog"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                >
                  Blog
                </Link>
              </li>
              <li>
                <Link 
                  to="/faq"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link 
                  to="/contact"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link 
                  to="/pricing"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                >
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-base font-medium mb-4">Payment Services</h4>
            <ul className="space-y-2">
              {[
                {name: 'Mobile Money', icon: <Smartphone className="h-4 w-4 mr-2" />, link: '/payment-services'},
                {name: 'Card Processing', icon: <CreditCard className="h-4 w-4 mr-2" />, link: '/payment-services'},
                {name: 'USSD Payments', icon: <Smartphone className="h-4 w-4 mr-2" />, link: '/ussd-access'},
                {name: 'Business Dashboard', icon: <Globe className="h-4 w-4 mr-2" />, link: '/dashboard'},
                {name: 'Merchant API', icon: <Shield className="h-4 w-4 mr-2" />, link: '/api'}
              ].map((item) => (
                <li key={item.name}>
                  <Link 
                    to={item.link}
                    className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300 flex items-center"
                  >
                    {item.icon}
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          <div>
            <h4 className="text-base font-medium mb-4">Contact Us</h4>
            <ul className="space-y-3">
              <li className="flex items-center text-primary-foreground/80">
                <MapPin className="h-4 w-4 mr-2" />
                <span>Cairo Road, Lusaka, Zambia</span>
              </li>
              <li>
                <a 
                  href="mailto:info@bmaglasspay.com"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300 flex items-center"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  info@bmaglasspay.com
                </a>
              </li>
              <li>
                <a 
                  href="tel:+260976123456"
                  className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300 flex items-center"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  +260 976 123 456
                </a>
              </li>
              <li className="pt-3 text-primary-foreground/60 text-sm">
                Business Hours: Mon-Fri 8:30 - 17:00
              </li>
            </ul>
            
            <div className="mt-6">
              <h5 className="text-sm font-medium mb-2">Payment Methods:</h5>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-primary-foreground/10 rounded text-xs">MTN Money</span>
                <span className="px-2 py-1 bg-primary-foreground/10 rounded text-xs">Airtel Money</span>
                <span className="px-2 py-1 bg-primary-foreground/10 rounded text-xs">Visa</span>
                <span className="px-2 py-1 bg-primary-foreground/10 rounded text-xs">Mastercard</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-12 pt-6 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center">
          <p className="text-primary-foreground/60 text-sm">
            &copy; {currentYear} BMaGlass Pay. All rights reserved. Founded by Mabvuto Banda.
          </p>
          <div className="mt-4 md:mt-0 flex items-center space-x-6">
            <Link to="/privacy-policy" className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300">
              Privacy Policy
            </Link>
            <Link to="/terms-of-service" className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300">
              Terms of Service
            </Link>
            <Link to="/compliance" className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300">
              Compliance
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
