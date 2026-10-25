import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import ProtectedRoute from '@/components/ProtectedRoute';
import type { Role } from '@/contexts/RoleContext';
import BusinessRouteGuard from '@/components/business/BusinessRouteGuard';
import PageTransition from '@/components/PageTransition';

// Pages are route-level code-split with React.lazy (only the landing
// page, Index, stays eager so `/` paints without an extra round-trip).
import Index from '@/pages/Index';
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const UserDashboard = lazy(() => import('@/pages/UserDashboard'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const BetaTesterDashboard = lazy(() => import('@/pages/BetaTesterDashboard'));
const BusinessDashboard = lazy(() => import('@/pages/BusinessDashboard'));
const RoleManagement = lazy(() => import('@/pages/RoleManagement'));
const TierManagement = lazy(() => import('@/pages/TierManagement'));
const Settings = lazy(() => import('@/pages/Settings'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const Transactions = lazy(() => import('@/pages/Transactions'));
const TransactionList = lazy(() => import('@/pages/TransactionList'));
const VirtualCardNew = lazy(() => import('@/pages/VirtualCardNew'));
const VirtualCardDetails = lazy(() => import('@/pages/VirtualCardDetails'));
const VirtualCardFund = lazy(() => import('@/pages/VirtualCardFund'));
const Transfer = lazy(() => import('@/pages/Transfer'));
const SendMoney = lazy(() => import('@/pages/SendMoney'));
const Business = lazy(() => import('@/pages/Business'));
const Compliance = lazy(() => import('@/pages/Compliance'));
const FeedbackDashboard = lazy(() => import('@/pages/FeedbackDashboard'));
const Feedback = lazy(() => import('@/pages/Feedback'));
const Help = lazy(() => import('@/pages/Help'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const UpdatePassword = lazy(() => import('@/pages/UpdatePassword'));
const Pricing = lazy(() => import('@/pages/Pricing'));
import { Navigate } from 'react-router-dom';
const Checkout = lazy(() => import('@/pages/Checkout'));
const SubscriptionTiers = lazy(() => import('@/pages/SubscriptionTiers'));
const Billing = lazy(() => import('@/pages/Billing'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const API = lazy(() => import('@/pages/API'));
const Support = lazy(() => import('@/pages/Support'));
const Rewards = lazy(() => import('@/pages/Rewards'));
const BitcoinWallet = lazy(() => import('@/pages/BitcoinWallet'));
const SelfCustodyWallet = lazy(() => import('@/pages/SelfCustodyWallet'));
const PaymentProcessor = lazy(() => import('@/pages/PaymentProcessor'));
const PaymentServices = lazy(() => import('@/pages/PaymentServices'));
const PaymentSuccess = lazy(() => import('@/pages/PaymentSuccess'));
const PaymentFailed = lazy(() => import('@/pages/PaymentFailed'));
const Disputes = lazy(() => import('@/pages/Disputes'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const SecuritySettings = lazy(() => import('@/pages/SecuritySettings'));
const TwoFactorAuth = lazy(() => import('@/pages/TwoFactorAuth'));
const KycPage = lazy(() => import('@/pages/KycPage'));
const VerifyIdentity = lazy(() => import('@/pages/VerifyIdentity'));
const UssdAccess = lazy(() => import('@/pages/UssdAccess'));
const WalletReconciliationPage = lazy(() => import('@/pages/WalletReconciliationPage'));
const About = lazy(() => import('@/pages/About'));
const Contact = lazy(() => import('@/pages/Contact'));
const Blog = lazy(() => import('@/pages/Blog'));
const Faq = lazy(() => import('@/pages/Faq'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));
const AdminMastercardMove = lazy(() => import('@/pages/AdminMastercardMove'));
const AdminPayoneer = lazy(() => import('@/pages/AdminPayoneer'));
const AdminStripe = lazy(() => import('@/pages/AdminStripe'));
const AdminMoonpay = lazy(() => import('@/pages/AdminMoonpay'));
const AdminPaypal = lazy(() => import('@/pages/AdminPaypal'));
const AdminTransactions = lazy(() => import('@/pages/AdminTransactions'));
const Developers = lazy(() => import('@/pages/Developers'));
const RequestMoney = lazy(() => import('@/pages/RequestMoney'));
const Contacts = lazy(() => import('@/pages/Contacts'));
const SpendingInsights = lazy(() => import('@/pages/SpendingInsights'));
const InvoicesPage = lazy(() => import('@/pages/Invoices'));
const BuyNowPayLater = lazy(() => import('@/pages/BuyNowPayLater'));
const ScheduledPayments = lazy(() => import('@/pages/ScheduledPayments'));
const BankTransfers = lazy(() => import('@/pages/BankTransfers'));
const CollectPayments = lazy(() => import('@/pages/CollectPayments'));
const PaymentLinks = lazy(() => import('@/pages/PaymentLinks'));
const BitcoinPos = lazy(() => import('@/pages/BitcoinPos'));
const SubAccounts = lazy(() => import('@/pages/SubAccounts'));
const SplitPayments = lazy(() => import('@/pages/SplitPayments'));
const MultiCurrencyWallet = lazy(() => import('@/pages/MultiCurrencyWallet'));
const BulkPayments = lazy(() => import('@/pages/BulkPayments'));
const Refunds = lazy(() => import('@/pages/Refunds'));
const PublicCheckout = lazy(() => import('@/pages/PublicCheckout'));
const InvoiceCheckout = lazy(() => import('@/pages/InvoiceCheckout'));
const RequestCheckout = lazy(() => import('@/pages/RequestCheckout'));
const Settlements = lazy(() => import('@/pages/Settlements'));
const SdkDocs = lazy(() => import('@/pages/SdkDocs'));
const WebhookLogs = lazy(() => import('@/pages/WebhookLogs'));
const CardVault = lazy(() => import('@/pages/CardVault'));
const CryptoWallet = lazy(() => import('@/pages/CryptoWallet'));

// New feature pages
const PaymentPlans = lazy(() => import('@/pages/PaymentPlans'));
const Escrow = lazy(() => import('@/pages/Escrow'));
const Savings = lazy(() => import('@/pages/Savings'));
const BillPayments = lazy(() => import('@/pages/BillPayments'));
const AgentNetwork = lazy(() => import('@/pages/AgentNetwork'));
const FraudRules = lazy(() => import('@/pages/FraudRules'));
const Statements = lazy(() => import('@/pages/Statements'));
const TransactionSearch = lazy(() => import('@/pages/TransactionSearch'));
const IpWhitelist = lazy(() => import('@/pages/IpWhitelist'));
const QrPayments = lazy(() => import('@/pages/QrPayments'));
const CheckoutWidget = lazy(() => import('@/pages/CheckoutWidget'));
const AmlScreening = lazy(() => import('@/pages/AmlScreening'));
const AuditLogs = lazy(() => import('@/pages/AuditLogs'));
const BackupExport = lazy(() => import('@/pages/BackupExport'));
const ApiRateLimits = lazy(() => import('@/pages/ApiRateLimits'));

// P2P marketplace (Phase 1c)
const P2PMarketplace = lazy(() => import('@/pages/P2PMarketplace'));
const P2PNewAd = lazy(() => import('@/pages/P2PNewAd'));
const P2PMyAds = lazy(() => import('@/pages/P2PMyAds'));
const P2POrders = lazy(() => import('@/pages/P2POrders'));
const P2PTradeRoom = lazy(() => import('@/pages/P2PTradeRoom'));
const P2PProfile = lazy(() => import('@/pages/P2PProfile'));
const P2PDispute = lazy(() => import('@/pages/P2PDispute'));
const AdminP2P = lazy(() => import('@/pages/AdminP2P'));
const AdminIdentity = lazy(() => import('@/pages/AdminIdentity'));
const AdminUserDetail = lazy(() => import('@/pages/AdminUserDetail'));
const AdminRoleRequests = lazy(() => import('@/pages/AdminRoleRequests'));
const AdminRefunds = lazy(() => import('@/pages/AdminRefunds'));

// Minimal route-loading fallback: a single centred spinner in the app's
// primary colour. Deliberately NOT PageSkeleton — that imports Header/Footer
// and would drag the heavy shell into the entry chunk / duplicate chrome.
const RouteFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
    <span className="sr-only">Loading…</span>
  </div>
);

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
      <Suspense fallback={<RouteFallback />}>
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
        <Route path="/admin/moonpay" element={<RoleGuardedPage roles={['admin', 'super_admin']}><AdminMoonpay /></RoleGuardedPage>} />
        <Route path="/admin/paypal" element={<RoleGuardedPage roles={['admin', 'super_admin']}><AdminPaypal /></RoleGuardedPage>} />
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
      </Suspense>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
