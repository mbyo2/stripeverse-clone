import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { CreditCard, Smartphone, Phone, Mail, MapPin, Shield, Globe, Facebook, Twitter, Linkedin, Instagram } from 'lucide-react';
import { FadeIn, StaggerChildren, StaggerItem } from '@/components/animations';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const socialLinks = [
    { href: 'https://facebook.com/bmaglasspay', icon: Facebook, label: 'Facebook' },
    { href: 'https://twitter.com/bmaglasspay', icon: Twitter, label: 'Twitter' },
    { href: 'https://linkedin.com/company/bmaglasspay', icon: Linkedin, label: 'LinkedIn' },
    { href: 'https://instagram.com/bmaglasspay', icon: Instagram, label: 'Instagram' },
  ];

  return (
    <footer className="py-12 px-4 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green text-white">
      <FadeIn duration={0.6} distance={20}>
        <div className="max-w-7xl mx-auto">
          <StaggerChildren 
            className="grid grid-cols-1 md:grid-cols-5 gap-10"
            staggerDelay={0.06}
          >
            <StaggerItem className="col-span-1 md:col-span-2">
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
            </StaggerItem>

            <StaggerItem>
              <h4 className="text-base font-medium mb-4">Company</h4>
              <ul className="space-y-2">
                {[
                  { to: '/about', label: 'About Us' },
                  { to: '/blog', label: 'Blog' },
                  { to: '/faq', label: 'FAQ' },
                  { to: '/contact', label: 'Contact' },
                  { to: '/pricing', label: 'Pricing' },
                ].map((item) => (
                  <li key={item.to}>
                    <motion.div whileHover={{ x: 4 }} transition={{ type: 'spring', stiffness: 300 }}>
                      <Link 
                        to={item.to}
                        className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300"
                      >
                        {item.label}
                      </Link>
                    </motion.div>
                  </li>
                ))}
              </ul>
            </StaggerItem>
            
            <StaggerItem>
              <h4 className="text-base font-medium mb-4">Payment Services</h4>
              <ul className="space-y-2">
                {[
                  { name: 'Mobile Money', icon: Smartphone, link: '/payment-services' },
                  { name: 'Card Processing', icon: CreditCard, link: '/payment-services' },
                  { name: 'USSD Payments', icon: Smartphone, link: '/ussd-access' },
                  { name: 'Business Dashboard', icon: Globe, link: '/dashboard' },
                  { name: 'Merchant API', icon: Shield, link: '/api' },
                ].map((item) => (
                  <li key={item.name}>
                    <motion.div whileHover={{ x: 4 }} transition={{ type: 'spring', stiffness: 300 }}>
                      <Link 
                        to={item.link}
                        className="text-primary-foreground/80 hover:text-primary-foreground transition-colors duration-300 flex items-center"
                      >
                        <item.icon className="h-4 w-4 mr-2" />
                        {item.name}
                      </Link>
                    </motion.div>
                  </li>
                ))}
              </ul>
            </StaggerItem>
            
            <StaggerItem>
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
                  {['MTN Money', 'Airtel Money', 'Visa', 'Mastercard'].map((method) => (
                    <motion.span 
                      key={method}
                      className="px-2 py-1 bg-primary-foreground/10 rounded text-xs"
                      whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.2)' }}
                      transition={{ type: 'spring', stiffness: 400 }}
                    >
                      {method}
                    </motion.span>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <h5 className="text-sm font-medium mb-3">Follow Us:</h5>
                <div className="flex items-center space-x-4">
                  {socialLinks.map((social) => (
                    <motion.a
                      key={social.label}
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-primary-foreground/10 rounded-full hover:bg-primary-foreground/20 transition-colors"
                      aria-label={social.label}
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    >
                      <social.icon className="h-4 w-4" />
                    </motion.a>
                  ))}
                </div>
              </div>
            </StaggerItem>
          </StaggerChildren>
          
          <motion.div 
            className="mt-12 pt-6 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            viewport={{ once: true }}
          >
            <p className="text-primary-foreground/60 text-sm">
              &copy; {currentYear} BMaGlass Pay. All rights reserved. Founded by Mabvuto Banda.
            </p>
            <div className="mt-4 md:mt-0 flex items-center space-x-6">
              {[
                { to: '/privacy-policy', label: 'Privacy Policy' },
                { to: '/terms-of-service', label: 'Terms of Service' },
                { to: '/compliance', label: 'Compliance' },
              ].map((link) => (
                <motion.div key={link.to} whileHover={{ y: -1 }}>
                  <Link 
                    to={link.to} 
                    className="text-primary-foreground/60 hover:text-primary-foreground text-sm transition-colors duration-300"
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </FadeIn>
    </footer>
  );
};

export default Footer;
