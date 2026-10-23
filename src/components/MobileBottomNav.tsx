import { Link, useLocation } from 'react-router-dom';
import { Home, Bitcoin, ArrowRightLeft, QrCode, Bell, User, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const MobileBottomNav = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [showMore, setShowMore] = useState(false);

  if (!user) return null;

  // The Bitcoin wallet is the main product, so it holds the second slot
  // with an orange chip; the fiat wallet stays one tap away via the header
  // drawer and the dashboard.
  const navItems = [
    { icon: Home, label: 'Home', path: '/dashboard', featured: false },
    { icon: Bitcoin, label: 'Bitcoin', path: '/bitcoin-wallet', featured: true },
    { icon: Send, label: 'Send', path: '/transfer', featured: false },
    { icon: QrCode, label: 'QR Pay', path: '/qr-payments', featured: false },
    { icon: Bell, label: 'Alerts', path: '/notifications', featured: false },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border md:hidden safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full py-2 transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.featured ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F7931A] text-black">
                  <item.icon className="h-5 w-5" />
                </span>
              ) : (
                <item.icon className={cn('h-5 w-5', isActive && 'text-primary')} />
              )}
              <span className={cn('text-xs mt-1', (isActive || item.featured) && 'font-semibold', item.featured && 'text-foreground')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
