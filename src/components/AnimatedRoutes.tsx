import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import ProtectedRoute from '@/components/ProtectedRoute';
import type { Role } from '@/contexts/RoleContext';
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
import SelfCustodyWallet from '@/pages/SelfCustodyWallet';
import PaymentProcessor from '@/pages/PaymentProcessor';
import PaymentServices from '@/pages/PaymentServices';
import PaymentSuccess from '@/pages/PaymentSuccess';
import PaymentFailed from '@/pages/PaymentFailed';
import Disputes from '@/pages/Disputes';
import Notifications from '@/pages/Notifications';
import SecuritySettings from '@/pages/SecuritySettings';
import TwoFactorAuth from '@/pages/TwoFactorAuth';
import KycPage from '@/pages/KycPage';
import VerifyIdentity from '@/pages/VerifyIdentity';
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
import AdminMastercardMove from '@/pages/AdminMastercardMove';
import AdminPayoneer from '@/pages/AdminPayoneer';
import AdminStripe from '@/pages/AdminStripe';
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
import BitcoinPos from '@/pages/BitcoinPos';
import SubAccounts from '@/pages/SubAccounts';
import SplitPayments from '@/pages/SplitPayments';
import MultiCurrencyWallet from '@/pages/MultiCurrencyWallet';
import BulkPayments from '@/pages/BulkPayments';
import Refunds from '@/pages/Refunds';
import PublicCheckout from '@/pages/PublicCheckout';
import InvoiceCheckout from '@/pages/InvoiceCheckout';
import RequestCheckout from '@/pages/RequestCheckout';
import Settlements from '@/pages/Settlements';
import SdkDocs from '@/pages/SdkDocs';
import WebhookLogs from '@/pages/WebhookLogs';
import CardVault from '@/pages/CardVault';
import CryptoWallet from '@/pages/CryptoWallet';

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

// P2P marketplace (Phase 1c)
import P2PMarketplace from '@/pages/P2PMarketplace';
import P2PNewAd from '@/pages/P2PNewAd';
import P2PMyAds from '@/pages/P2PMyAds';
import P2POrders from '@/pages/P2POrders';
import P2PTradeRoom from '@/pages/P2PTradeRoom';
import P2PProfile from '@/pages/P2PProfile';
import P2PDispute from '@/pages/P2PDispute';
import AdminP2P from '@/pages/AdminP2P';
import AdminIdentity from '@/pages/AdminIdentity';
import AdminUserDetail from '@/pages/AdminUserDetail';
import AdminRoleRequests from '@/pages/AdminRoleRequests';
import AdminRefunds from '@/pages/AdminRefunds';

const ProtectedPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><PageTransition>{children}</PageTransition></ProtectedRoute>
);

// Admin console gate: every admin route admits admin OR super_admin
// (super_admin is additive over admin — the foundation's design), so a
// super_admin-only holder is never locked out of the console. The P2P
// console additionally admits the per-feature p2p_admin role.
const ADMIN_ROLES: Role[] = ['admin', 'super_admin'];
const P2P_ADMIN_ROLES: Role[] = ['admin', 'super_admin', 'p2p_admin'];
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
        {/* Natural short URLs for the legal pages (bookmarks, printed
            material, partner links) — the canonical pages live at the
            long paths above. */}
        <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
        <Route path="/terms" element={<Navigate to="/terms-of-service" replace />} />
        {/* Public content pages the public nav links to: these render
            for logged-out visitors. Account-specific sections inside
            them are gated within the pages themselves. */}
        <Route path="/business" element={<PageTransition><Business /></PageTransition>} />
        <Route path="/api" element={<PageTransition><API /></PageTransition>} />
        <Route path="/support" element={<PageTransition><Support /></PageTransition>} />
        <Route path="/help" element={<PageTransition><Help /></PageTransition>} />
        <Route path="/developers" element={<PageTransition><Developers /></PageTransition>} />
        <Route path="/pay/:code" element={<PageTransition><PublicCheckout /></PageTransition>} />
        <Route path="/invoice/:code" element={<PageTransition><InvoiceCheckout /></PageTransition>} />
        <Route path="/request/:code" element={<PageTransition><RequestCheckout /></PageTransition>} />
        <Route path="/sdk-docs" element={<PageTransition><SdkDocs /></PageTransition>} />
        <Route path="/payment-success" element={<PageTransition><PaymentSuccess /></PageTransition>} />
        <Route path="/payment-failed" element={<PageTransition><PaymentFailed /></PageTransition>} />
        
        {/* Protected routes */}
        <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
        <Route path="/user-dashboard" element={<ProtectedPage><UserDashboard /></ProtectedPage>} />
        <Route path="/admin-dashboard" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminDashboard /></RoleGuardedPage>} />
        <Route path="/beta-dashboard" element={<RoleGuardedPage roles={['beta_tester','admin','super_admin']}><BetaTesterDashboard /></RoleGuardedPage>} />

        <Route path="/business-dashboard" element={
          <ProtectedRoute><BusinessRouteGuard><PageTransition><BusinessDashboard /></PageTransition></BusinessRouteGuard></ProtectedRoute>
        } />

        {/* Role Management is the self-service page (own roles, role
            requests, security tab) linked from every account menu and
            from ProtectedRoute's own "Request Access" action — it is
            for every signed-in user, not an admin console page. The
            admin side of role requests lives at /admin/role-requests. */}
        <Route path="/role-management" element={<ProtectedPage><RoleManagement /></ProtectedPage>} />
        <Route path="/tier-management" element={<RoleGuardedPage roles={ADMIN_ROLES}><TierManagement /></RoleGuardedPage>} />
        <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
        <Route path="/security-settings" element={<ProtectedPage><SecuritySettings /></ProtectedPage>} />
        <Route path="/two-factor-auth" element={<ProtectedPage><TwoFactorAuth /></ProtectedPage>} />
        <Route path="/profile" element={<Navigate to="/settings" replace />} />
        <Route path="/wallet" element={<ProtectedPage><Wallet /></ProtectedPage>} />
        <Route path="/bitcoin-wallet" element={<ProtectedPage><BitcoinWallet /></ProtectedPage>} />
        <Route path="/bitcoin-wallet/self-custody" element={<ProtectedPage><SelfCustodyWallet /></ProtectedPage>} />
        <Route path="/wallet/crypto" element={<ProtectedPage><CryptoWallet /></ProtectedPage>} />
        <Route path="/wallet-reconciliation" element={<ProtectedPage><WalletReconciliationPage /></ProtectedPage>} />
        <Route path="/transactions" element={<ProtectedPage><Transactions /></ProtectedPage>} />
        <Route path="/transaction-list" element={<ProtectedPage><TransactionList /></ProtectedPage>} />
        <Route path="/transaction-search" element={<ProtectedPage><TransactionSearch /></ProtectedPage>} />
        <Route path="/billing" element={<ProtectedPage><Billing /></ProtectedPage>} />
        <Route path="/analytics" element={<ProtectedRoute requiredFeature="analytics"><PageTransition><Analytics /></PageTransition></ProtectedRoute>} />
        <Route path="/card/new" element={<ProtectedPage><VirtualCardNew /></ProtectedPage>} />
        {/* Natural card URLs (what people type and what older links
            may still carry) — the canonical create page is /card/new. */}
        <Route path="/cards" element={<Navigate to="/card/new" replace />} />
        <Route path="/virtual-cards" element={<Navigate to="/card/new" replace />} />
        <Route path="/card/:id" element={<ProtectedPage><VirtualCardDetails /></ProtectedPage>} />
        <Route path="/card/:id/fund" element={<ProtectedPage><VirtualCardFund /></ProtectedPage>} />
        <Route path="/transfer" element={<ProtectedRoute requiredFeature="transfers"><PageTransition><Transfer /></PageTransition></ProtectedRoute>} />
        <Route path="/send-money" element={<ProtectedPage><SendMoney /></ProtectedPage>} />
        <Route path="/compliance" element={<RoleGuardedPage roles={['admin','super_admin','business']}><Compliance /></RoleGuardedPage>} />
        <Route path="/feedback-dashboard" element={<RoleGuardedPage roles={ADMIN_ROLES}><FeedbackDashboard /></RoleGuardedPage>} />
        <Route path="/feedback" element={<ProtectedPage><Feedback /></ProtectedPage>} />
        <Route path="/rewards" element={<ProtectedPage><Rewards /></ProtectedPage>} />
        <Route path="/payment-processor" element={<ProtectedRoute requiredFeature="business_tools"><PageTransition><PaymentProcessor /></PageTransition></ProtectedRoute>} />
        <Route path="/payment-services" element={<ProtectedPage><PaymentServices /></ProtectedPage>} />
        <Route path="/disputes" element={<ProtectedPage><Disputes /></ProtectedPage>} />
        <Route path="/notifications" element={<ProtectedPage><Notifications /></ProtectedPage>} />
        <Route path="/kyc" element={<ProtectedPage><KycPage /></ProtectedPage>} />
        <Route path="/verify-identity" element={<ProtectedPage><VerifyIdentity /></ProtectedPage>} />
        <Route path="/ussd-access" element={<ProtectedPage><UssdAccess /></ProtectedPage>} />
        <Route path="/admin/users" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminUsers /></RoleGuardedPage>} />
        <Route path="/admin/transactions" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminTransactions /></RoleGuardedPage>} />
        <Route path="/admin/mastercard-move" element={<RoleGuardedPage roles={['admin', 'super_admin']}><AdminMastercardMove /></RoleGuardedPage>} />
        <Route path="/admin/payoneer" element={<RoleGuardedPage roles={['admin', 'super_admin']}><AdminPayoneer /></RoleGuardedPage>} />
        <Route path="/admin/stripe" element={<RoleGuardedPage roles={['admin', 'super_admin']}><AdminStripe /></RoleGuardedPage>} />
        <Route path="/admin/p2p" element={<RoleGuardedPage roles={P2P_ADMIN_ROLES}><AdminP2P /></RoleGuardedPage>} />
        <Route path="/admin/identity" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminIdentity /></RoleGuardedPage>} />
        <Route path="/admin/users/:userId" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminUserDetail /></RoleGuardedPage>} />
        <Route path="/admin/role-requests" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminRoleRequests /></RoleGuardedPage>} />
        <Route path="/admin/refunds" element={<RoleGuardedPage roles={ADMIN_ROLES}><AdminRefunds /></RoleGuardedPage>} />
        {/* Admin landing + natural console URLs: /admin itself and the
            section names people type land on the real console pages
            instead of the 404 catch-all. */}
        <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        <Route path="/admin/analytics" element={<Navigate to="/analytics" replace />} />
        <Route path="/admin/compliance" element={<Navigate to="/compliance" replace />} />
        <Route path="/admin/disputes" element={<Navigate to="/admin/p2p" replace />} />

        {/* P2P marketplace */}
        <Route path="/p2p" element={<ProtectedPage><P2PMarketplace /></ProtectedPage>} />
        <Route path="/p2p/ads/new" element={<ProtectedPage><P2PNewAd /></ProtectedPage>} />
        <Route path="/p2p/my-ads" element={<ProtectedPage><P2PMyAds /></ProtectedPage>} />
        <Route path="/p2p/orders" element={<ProtectedPage><P2POrders /></ProtectedPage>} />
        <Route path="/p2p/orders/:id" element={<ProtectedPage><P2PTradeRoom /></ProtectedPage>} />
        <Route path="/p2p/profile" element={<ProtectedPage><P2PProfile /></ProtectedPage>} />
        <Route path="/p2p/disputes/:id" element={<ProtectedPage><P2PDispute /></ProtectedPage>} />
        <Route path="/request-money" element={<ProtectedPage><RequestMoney /></ProtectedPage>} />
        <Route path="/contacts" element={<ProtectedPage><Contacts /></ProtectedPage>} />
        <Route path="/spending-insights" element={<ProtectedPage><SpendingInsights /></ProtectedPage>} />
        <Route path="/invoices" element={<ProtectedPage><InvoicesPage /></ProtectedPage>} />
        <Route path="/pay-later" element={<ProtectedPage><BuyNowPayLater /></ProtectedPage>} />
        <Route path="/scheduled-payments" element={<ProtectedPage><ScheduledPayments /></ProtectedPage>} />
        <Route path="/bank-transfers" element={<ProtectedPage><BankTransfers /></ProtectedPage>} />
        <Route path="/collect-payments" element={<ProtectedPage><CollectPayments /></ProtectedPage>} />
        <Route path="/payment-links" element={<ProtectedPage><PaymentLinks /></ProtectedPage>} />
        <Route path="/pos" element={<ProtectedPage><BitcoinPos /></ProtectedPage>} />
        <Route path="/sub-accounts" element={<ProtectedPage><SubAccounts /></ProtectedPage>} />
        {/* "/splits" is the natural short URL people type — the real
            page (recipients, rules, settlement preview) lives at
            /split-payments, which is also where the menus point. */}
        <Route path="/splits" element={<Navigate to="/split-payments" replace />} />
        <Route path="/split-payments" element={<ProtectedPage><SplitPayments /></ProtectedPage>} />
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
        <Route path="/fraud-rules" element={<RoleGuardedPage roles={['admin','super_admin','business']}><FraudRules /></RoleGuardedPage>} />
        <Route path="/statements" element={<ProtectedPage><Statements /></ProtectedPage>} />
        <Route path="/ip-whitelist" element={<ProtectedPage><IpWhitelist /></ProtectedPage>} />
        <Route path="/qr-payments" element={<ProtectedPage><QrPayments /></ProtectedPage>} />
        <Route path="/checkout-widget" element={<ProtectedPage><CheckoutWidget /></ProtectedPage>} />
        <Route path="/aml-screening" element={<RoleGuardedPage roles={ADMIN_ROLES}><AmlScreening /></RoleGuardedPage>} />
        <Route path="/audit-logs" element={<RoleGuardedPage roles={ADMIN_ROLES}><AuditLogs /></RoleGuardedPage>} />
        <Route path="/backup-export" element={<RoleGuardedPage roles={ADMIN_ROLES}><BackupExport /></RoleGuardedPage>} />
        <Route path="/api-rate-limits" element={<RoleGuardedPage roles={['admin','super_admin','business']}><ApiRateLimits /></RoleGuardedPage>} />

        {/* Catch-all 404 route */}
        <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
