import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import ProtectedRoute from '@/components/ProtectedRoute';
import BusinessRouteGuard from '@/components/business/BusinessRouteGuard';
import PageTransition from '@/components/PageTransition';

// Import all pages
import Index from '@/pages/Index';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import UserDashboard from '@/pages/UserDashboard';
import AdminDashboard from '@/pages/AdminDashboard';
import BetaTesterDashboard from '@/pages/BetaTesterDashboard';
import BusinessDashboard from '@/pages/BusinessDashboard';
import RoleManagement from '@/pages/RoleManagement';
import TierManagement from '@/pages/TierManagement';
import Settings from '@/pages/Settings';
import Wallet from '@/pages/Wallet';
import Transactions from '@/pages/Transactions';
import TransactionList from '@/pages/TransactionList';
import VirtualCardNew from '@/pages/VirtualCardNew';
import VirtualCardDetails from '@/pages/VirtualCardDetails';
import VirtualCardFund from '@/pages/VirtualCardFund';
import Transfer from '@/pages/Transfer';
import SendMoney from '@/pages/SendMoney';
import Business from '@/pages/Business';
import Compliance from '@/pages/Compliance';
import FeedbackDashboard from '@/pages/FeedbackDashboard';
import Feedback from '@/pages/Feedback';
import Help from '@/pages/Help';
import ResetPassword from '@/pages/ResetPassword';
import UpdatePassword from '@/pages/UpdatePassword';
import Pricing from '@/pages/Pricing';
import Profile from '@/pages/Profile';
import Checkout from '@/pages/Checkout';
import SubscriptionTiers from '@/pages/SubscriptionTiers';
import Billing from '@/pages/Billing';
import Analytics from '@/pages/Analytics';
import API from '@/pages/API';
import Support from '@/pages/Support';
import Rewards from '@/pages/Rewards';
import BitcoinWallet from '@/pages/BitcoinWallet';
import PaymentProcessor from '@/pages/PaymentProcessor';
import PaymentServices from '@/pages/PaymentServices';
import PaymentSuccess from '@/pages/PaymentSuccess';
import PaymentFailed from '@/pages/PaymentFailed';
import Disputes from '@/pages/Disputes';
import Notifications from '@/pages/Notifications';
import SecuritySettings from '@/pages/SecuritySettings';
import TwoFactorAuth from '@/pages/TwoFactorAuth';
import KycPage from '@/pages/KycPage';
import UssdAccess from '@/pages/UssdAccess';
import WalletReconciliationPage from '@/pages/WalletReconciliationPage';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Blog from '@/pages/Blog';
import Faq from '@/pages/Faq';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsOfService from '@/pages/TermsOfService';
import NotFound from '@/pages/NotFound';

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public routes */}
        <Route path="/" element={<PageTransition><Index /></PageTransition>} />
        <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
        <Route path="/register" element={<PageTransition><Register /></PageTransition>} />
        <Route path="/reset-password" element={<PageTransition><ResetPassword /></PageTransition>} />
        <Route path="/update-password" element={<PageTransition><UpdatePassword /></PageTransition>} />
        <Route path="/pricing" element={<PageTransition><Pricing /></PageTransition>} />
        <Route path="/subscription-tiers" element={<PageTransition><SubscriptionTiers /></PageTransition>} />
        <Route path="/checkout/*" element={<PageTransition><Checkout /></PageTransition>} />
        <Route path="/about" element={<PageTransition><About /></PageTransition>} />
        <Route path="/contact" element={<PageTransition><Contact /></PageTransition>} />
        <Route path="/blog" element={<PageTransition><Blog /></PageTransition>} />
        <Route path="/faq" element={<PageTransition><Faq /></PageTransition>} />
        <Route path="/privacy-policy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
        <Route path="/terms-of-service" element={<PageTransition><TermsOfService /></PageTransition>} />
        <Route path="/payment-success" element={<PageTransition><PaymentSuccess /></PageTransition>} />
        <Route path="/payment-failed" element={<PageTransition><PaymentFailed /></PageTransition>} />
        
        {/* Protected routes */}
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <PageTransition><Dashboard /></PageTransition>
          </ProtectedRoute>
        } />
        
        {/* Role-specific dashboards */}
        <Route path="/user-dashboard" element={
          <ProtectedRoute>
            <PageTransition><UserDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        
        <Route path="/admin-dashboard" element={
          <ProtectedRoute>
            <PageTransition><AdminDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        
        <Route path="/beta-dashboard" element={
          <ProtectedRoute>
            <PageTransition><BetaTesterDashboard /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/business-dashboard" element={
          <ProtectedRoute>
            <BusinessRouteGuard>
              <PageTransition><BusinessDashboard /></PageTransition>
            </BusinessRouteGuard>
          </ProtectedRoute>
        } />

        <Route path="/business" element={
          <ProtectedRoute>
            <BusinessRouteGuard>
              <PageTransition><Business /></PageTransition>
            </BusinessRouteGuard>
          </ProtectedRoute>
        } />
        
        <Route path="/role-management" element={
          <ProtectedRoute>
            <PageTransition><RoleManagement /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/tier-management" element={
          <ProtectedRoute>
            <PageTransition><TierManagement /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute>
            <PageTransition><Settings /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/security-settings" element={
          <ProtectedRoute>
            <PageTransition><SecuritySettings /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/two-factor-auth" element={
          <ProtectedRoute>
            <PageTransition><TwoFactorAuth /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute>
            <PageTransition><Profile /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/wallet" element={
          <ProtectedRoute>
            <PageTransition><Wallet /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/bitcoin-wallet" element={
          <ProtectedRoute>
            <PageTransition><BitcoinWallet /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/wallet-reconciliation" element={
          <ProtectedRoute>
            <PageTransition><WalletReconciliationPage /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/transactions" element={
          <ProtectedRoute>
            <PageTransition><Transactions /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/transaction-list" element={
          <ProtectedRoute>
            <PageTransition><TransactionList /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/billing" element={
          <ProtectedRoute>
            <PageTransition><Billing /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/analytics" element={
          <ProtectedRoute requiredFeature="analytics">
            <PageTransition><Analytics /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/api" element={
          <ProtectedRoute requiredFeature="business_tools">
            <PageTransition><API /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/support" element={
          <ProtectedRoute>
            <PageTransition><Support /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/card/new" element={
          <ProtectedRoute>
            <PageTransition><VirtualCardNew /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/card/:id" element={
          <ProtectedRoute>
            <PageTransition><VirtualCardDetails /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/card/:id/fund" element={
          <ProtectedRoute>
            <PageTransition><VirtualCardFund /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/transfer" element={
          <ProtectedRoute requiredFeature="transfers">
            <PageTransition><Transfer /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/send-money" element={
          <ProtectedRoute>
            <PageTransition><SendMoney /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/compliance" element={
          <ProtectedRoute>
            <PageTransition><Compliance /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/feedback-dashboard" element={
          <ProtectedRoute requiredFeature="feedback_dashboard">
            <PageTransition><FeedbackDashboard /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/feedback" element={
          <ProtectedRoute>
            <PageTransition><Feedback /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/help" element={
          <ProtectedRoute>
            <PageTransition><Help /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/rewards" element={
          <ProtectedRoute>
            <PageTransition><Rewards /></PageTransition>
          </ProtectedRoute>
        } />
        
        <Route path="/payment-processor" element={
          <ProtectedRoute requiredFeature="business_tools">
            <PageTransition><PaymentProcessor /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/payment-services" element={
          <ProtectedRoute>
            <PageTransition><PaymentServices /></PageTransition>
          </ProtectedRoute>
        } />
        
        <Route path="/disputes" element={
          <ProtectedRoute>
            <PageTransition><Disputes /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/notifications" element={
          <ProtectedRoute>
            <PageTransition><Notifications /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/kyc" element={
          <ProtectedRoute>
            <PageTransition><KycPage /></PageTransition>
          </ProtectedRoute>
        } />

        <Route path="/ussd-access" element={
          <ProtectedRoute>
            <PageTransition><UssdAccess /></PageTransition>
          </ProtectedRoute>
        } />

        {/* Catch-all 404 route */}
        <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
