import { Link, useLocation } from 'react-router-dom';
import { Home, Wallet, ArrowRightLeft, QrCode, Bell, User, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const MobileBottomNav = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [showMore, setShowMore] = useState(false);

  if (!user) return null;

  const navItems = [
    { icon: Home, label: 'Home', path: '/dashboard' },
    { icon: Send, label: 'Send', path: '/transfer' },
    { icon: QrCode, label: 'QR Pay', path: '/qr-payments' },
    { icon: Wallet, label: 'Wallet', path: '/wallet' },
    { icon: Bell, label: 'Alerts', path: '/notifications' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden safe-area-inset-bottom">
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
              <item.icon className={cn('h-5 w-5', isActive && 'text-primary')} />
              <span className={cn('text-xs mt-1', isActive && 'font-medium')}>
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
