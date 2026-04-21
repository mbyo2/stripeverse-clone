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
import { Navigate } from 'react-router-dom';
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
import AdminUsers from '@/pages/AdminUsers';
import AdminTransactions from '@/pages/AdminTransactions';
import Developers from '@/pages/Developers';
import RequestMoney from '@/pages/RequestMoney';
import Contacts from '@/pages/Contacts';
import SpendingInsights from '@/pages/SpendingInsights';
import InvoicesPage from '@/pages/Invoices';
import BuyNowPayLater from '@/pages/BuyNowPayLater';
import ScheduledPayments from '@/pages/ScheduledPayments';
import BankTransfers from '@/pages/BankTransfers';
import CollectPayments from '@/pages/CollectPayments';
import PaymentLinks from '@/pages/PaymentLinks';
import SubAccounts from '@/pages/SubAccounts';
import MultiCurrencyWallet from '@/pages/MultiCurrencyWallet';
import BulkPayments from '@/pages/BulkPayments';
import Refunds from '@/pages/Refunds';
import PublicCheckout from '@/pages/PublicCheckout';
import Settlements from '@/pages/Settlements';
import SdkDocs from '@/pages/SdkDocs';
import WebhookLogs from '@/pages/WebhookLogs';
import CardVault from '@/pages/CardVault';

// New feature pages
import PaymentPlans from '@/pages/PaymentPlans';
import Escrow from '@/pages/Escrow';
import Savings from '@/pages/Savings';
import BillPayments from '@/pages/BillPayments';
import AgentNetwork from '@/pages/AgentNetwork';
import FraudRules from '@/pages/FraudRules';
import Statements from '@/pages/Statements';
import TransactionSearch from '@/pages/TransactionSearch';
import IpWhitelist from '@/pages/IpWhitelist';
import QrPayments from '@/pages/QrPayments';
import CheckoutWidget from '@/pages/CheckoutWidget';
import AmlScreening from '@/pages/AmlScreening';
import AuditLogs from '@/pages/AuditLogs';
import BackupExport from '@/pages/BackupExport';
import ApiRateLimits from '@/pages/ApiRateLimits';

const ProtectedPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><PageTransition>{children}</PageTransition></ProtectedRoute>
);

type Role = 'admin' | 'business' | 'user' | 'beta_tester';
const RoleGuardedPage = ({ children, roles }: { children: React.ReactNode; roles: Role[] }) => (
  <ProtectedRoute requiredRoles={roles}><PageTransition>{children}</PageTransition></ProtectedRoute>
);

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
        <Route path="/developers" element={<PageTransition><Developers /></PageTransition>} />
        <Route path="/pay/:code" element={<PageTransition><PublicCheckout /></PageTransition>} />
        <Route path="/sdk-docs" element={<PageTransition><SdkDocs /></PageTransition>} />
        <Route path="/payment-success" element={<PageTransition><PaymentSuccess /></PageTransition>} />
        <Route path="/payment-failed" element={<PageTransition><PaymentFailed /></PageTransition>} />
        
        {/* Protected routes */}
        <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
        <Route path="/user-dashboard" element={<ProtectedPage><UserDashboard /></ProtectedPage>} />
        <Route path="/admin-dashboard" element={<RoleGuardedPage roles={['admin']}><AdminDashboard /></RoleGuardedPage>} />
        <Route path="/beta-dashboard" element={<RoleGuardedPage roles={['beta_tester','admin']}><BetaTesterDashboard /></RoleGuardedPage>} />

        <Route path="/business-dashboard" element={
          <ProtectedRoute><BusinessRouteGuard><PageTransition><BusinessDashboard /></PageTransition></BusinessRouteGuard></ProtectedRoute>
        } />
        <Route path="/business" element={
          <ProtectedRoute><BusinessRouteGuard><PageTransition><Business /></PageTransition></BusinessRouteGuard></ProtectedRoute>
        } />
        
        <Route path="/role-management" element={<RoleGuardedPage roles={['admin']}><RoleManagement /></RoleGuardedPage>} />
        <Route path="/tier-management" element={<RoleGuardedPage roles={['admin']}><TierManagement /></RoleGuardedPage>} />
        <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
        <Route path="/security-settings" element={<ProtectedPage><SecuritySettings /></ProtectedPage>} />
        <Route path="/two-factor-auth" element={<ProtectedPage><TwoFactorAuth /></ProtectedPage>} />
        <Route path="/profile" element={<Navigate to="/settings" replace />} />
        <Route path="/wallet" element={<ProtectedPage><Wallet /></ProtectedPage>} />
        <Route path="/bitcoin-wallet" element={<ProtectedPage><BitcoinWallet /></ProtectedPage>} />
        <Route path="/wallet-reconciliation" element={<ProtectedPage><WalletReconciliationPage /></ProtectedPage>} />
        <Route path="/transactions" element={<ProtectedPage><Transactions /></ProtectedPage>} />
        <Route path="/transaction-list" element={<ProtectedPage><TransactionList /></ProtectedPage>} />
        <Route path="/transaction-search" element={<ProtectedPage><TransactionSearch /></ProtectedPage>} />
        <Route path="/billing" element={<ProtectedPage><Billing /></ProtectedPage>} />
        <Route path="/analytics" element={<ProtectedRoute requiredFeature="analytics"><PageTransition><Analytics /></PageTransition></ProtectedRoute>} />
        <Route path="/api" element={<ProtectedRoute requiredFeature="business_tools"><PageTransition><API /></PageTransition></ProtectedRoute>} />
        <Route path="/support" element={<ProtectedPage><Support /></ProtectedPage>} />
        <Route path="/card/new" element={<ProtectedPage><VirtualCardNew /></ProtectedPage>} />
        <Route path="/card/:id" element={<ProtectedPage><VirtualCardDetails /></ProtectedPage>} />
        <Route path="/card/:id/fund" element={<ProtectedPage><VirtualCardFund /></ProtectedPage>} />
        <Route path="/transfer" element={<ProtectedRoute requiredFeature="transfers"><PageTransition><Transfer /></PageTransition></ProtectedRoute>} />
        <Route path="/send-money" element={<ProtectedPage><SendMoney /></ProtectedPage>} />
        <Route path="/compliance" element={<RoleGuardedPage roles={['admin','business']}><Compliance /></RoleGuardedPage>} />
        <Route path="/feedback-dashboard" element={<RoleGuardedPage roles={['admin']}><FeedbackDashboard /></RoleGuardedPage>} />
        <Route path="/feedback" element={<ProtectedPage><Feedback /></ProtectedPage>} />
        <Route path="/help" element={<ProtectedPage><Help /></ProtectedPage>} />
        <Route path="/rewards" element={<ProtectedPage><Rewards /></ProtectedPage>} />
        <Route path="/payment-processor" element={<ProtectedRoute requiredFeature="business_tools"><PageTransition><PaymentProcessor /></PageTransition></ProtectedRoute>} />
        <Route path="/payment-services" element={<ProtectedPage><PaymentServices /></ProtectedPage>} />
        <Route path="/disputes" element={<ProtectedPage><Disputes /></ProtectedPage>} />
        <Route path="/notifications" element={<ProtectedPage><Notifications /></ProtectedPage>} />
        <Route path="/kyc" element={<ProtectedPage><KycPage /></ProtectedPage>} />
        <Route path="/ussd-access" element={<ProtectedPage><UssdAccess /></ProtectedPage>} />
        <Route path="/admin/users" element={<RoleGuardedPage roles={['admin']}><AdminUsers /></RoleGuardedPage>} />
        <Route path="/admin/transactions" element={<RoleGuardedPage roles={['admin']}><AdminTransactions /></RoleGuardedPage>} />
        <Route path="/request-money" element={<ProtectedPage><RequestMoney /></ProtectedPage>} />
        <Route path="/contacts" element={<ProtectedPage><Contacts /></ProtectedPage>} />
        <Route path="/spending-insights" element={<ProtectedPage><SpendingInsights /></ProtectedPage>} />
        <Route path="/invoices" element={<ProtectedPage><InvoicesPage /></ProtectedPage>} />
        <Route path="/pay-later" element={<ProtectedPage><BuyNowPayLater /></ProtectedPage>} />
        <Route path="/scheduled-payments" element={<ProtectedPage><ScheduledPayments /></ProtectedPage>} />
        <Route path="/bank-transfers" element={<ProtectedPage><BankTransfers /></ProtectedPage>} />
        <Route path="/collect-payments" element={<ProtectedPage><CollectPayments /></ProtectedPage>} />
        <Route path="/payment-links" element={<ProtectedPage><PaymentLinks /></ProtectedPage>} />
        <Route path="/sub-accounts" element={<ProtectedPage><SubAccounts /></ProtectedPage>} />
        <Route path="/multi-currency" element={<ProtectedPage><MultiCurrencyWallet /></ProtectedPage>} />
        <Route path="/bulk-payments" element={<ProtectedPage><BulkPayments /></ProtectedPage>} />
        <Route path="/refunds" element={<ProtectedPage><Refunds /></ProtectedPage>} />
        <Route path="/settlements" element={<ProtectedPage><Settlements /></ProtectedPage>} />
        <Route path="/webhook-logs" element={<ProtectedPage><WebhookLogs /></ProtectedPage>} />
        <Route path="/card-vault" element={<ProtectedPage><CardVault /></ProtectedPage>} />

        {/* New feature routes */}
        <Route path="/payment-plans" element={<ProtectedPage><PaymentPlans /></ProtectedPage>} />
        <Route path="/escrow" element={<ProtectedPage><Escrow /></ProtectedPage>} />
        <Route path="/savings" element={<ProtectedPage><Savings /></ProtectedPage>} />
        <Route path="/bill-payments" element={<ProtectedPage><BillPayments /></ProtectedPage>} />
        <Route path="/agent-network" element={<ProtectedPage><AgentNetwork /></ProtectedPage>} />
        <Route path="/fraud-rules" element={<RoleGuardedPage roles={['admin','business']}><FraudRules /></RoleGuardedPage>} />
        <Route path="/statements" element={<ProtectedPage><Statements /></ProtectedPage>} />
        <Route path="/ip-whitelist" element={<ProtectedPage><IpWhitelist /></ProtectedPage>} />
        <Route path="/qr-payments" element={<ProtectedPage><QrPayments /></ProtectedPage>} />
        <Route path="/checkout-widget" element={<ProtectedPage><CheckoutWidget /></ProtectedPage>} />
        <Route path="/aml-screening" element={<RoleGuardedPage roles={['admin']}><AmlScreening /></RoleGuardedPage>} />
        <Route path="/audit-logs" element={<RoleGuardedPage roles={['admin']}><AuditLogs /></RoleGuardedPage>} />
        <Route path="/backup-export" element={<RoleGuardedPage roles={['admin']}><BackupExport /></RoleGuardedPage>} />
        <Route path="/api-rate-limits" element={<RoleGuardedPage roles={['admin','business']}><ApiRateLimits /></RoleGuardedPage>} />

        {/* Catch-all 404 route */}
        <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
