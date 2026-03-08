import { Link } from 'react-router-dom';
import { CreditCard, Mail, MapPin, Phone } from 'lucide-react';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const footerSections = [
    {
      title: 'Products',
      links: [
        { to: '/payment-services', label: 'Payment Processing' },
        { to: '/ussd-access', label: 'USSD Payments' },
        { to: '/card/new', label: 'Virtual Cards' },
        { to: '/wallet', label: 'Digital Wallet' },
        { to: '/bitcoin-wallet', label: 'Bitcoin Wallet' },
      ],
    },
    {
      title: 'Business',
      links: [
        { to: '/business', label: 'Business Tools' },
        { to: '/developers', label: 'Developer Portal' },
        { to: '/api', label: 'API Reference' },
        { to: '/pricing', label: 'Pricing' },
        { to: '/billing', label: 'Billing' },
      ],
    },
    {
      title: 'Company',
      links: [
        { to: '/about', label: 'About Us' },
        { to: '/blog', label: 'Blog' },
        { to: '/contact', label: 'Contact' },
        { to: '/faq', label: 'FAQ' },
        { to: '/support', label: 'Support' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { to: '/privacy-policy', label: 'Privacy Policy' },
        { to: '/terms-of-service', label: 'Terms of Service' },
        { to: '/compliance', label: 'Compliance' },
      ],
    },
  ];

  return (
    <footer className="bg-foreground text-background/80">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6">
        {/* Main Footer */}
        <div className="py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold text-background">BMaGlass<span className="text-primary-foreground/70">Pay</span></span>
            </div>
            <p className="text-sm text-background/60 mb-4 max-w-xs">
              Zambia's trusted payment gateway. Secure, fast, and built for African businesses.
            </p>
            <div className="space-y-2 text-sm text-background/60">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" />
                <span>Cairo Road, Lusaka</span>
              </div>
              <a href="mailto:info@bmaglasspay.com" className="flex items-center gap-2 hover:text-background transition-colors">
                <Mail className="h-3.5 w-3.5" />
                <span>info@bmaglasspay.com</span>
              </a>
              <a href="tel:+260976123456" className="flex items-center gap-2 hover:text-background transition-colors">
                <Phone className="h-3.5 w-3.5" />
                <span>+260 976 123 456</span>
              </a>
            </div>
          </div>

          {/* Link Sections */}
          {footerSections.map((section) => (
            <div key={section.title}>
              <h4 className="text-sm font-semibold text-background mb-4">{section.title}</h4>
              <ul className="space-y-2.5">
                {section.links.map((link) => (
                  <li key={link.to}>
                    <Link 
                      to={link.to}
                      className="text-sm text-background/60 hover:text-background transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="py-6 border-t border-background/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-background/50">
            © {currentYear} BMaGlass Pay. All rights reserved. Founded by Mabvuto Banda.
          </p>
          <div className="flex items-center gap-4">
            {['MTN Money', 'Airtel Money', 'Visa', 'Mastercard'].map((method) => (
              <span key={method} className="px-2 py-1 bg-background/10 rounded text-xs text-background/60">
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
