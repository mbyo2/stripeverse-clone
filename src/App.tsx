
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RoleProvider } from "@/contexts/RoleContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import BusinessRouteGuard from "@/components/business/BusinessRouteGuard";

// Import all pages
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import UserDashboard from "./pages/UserDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import BetaTesterDashboard from "./pages/BetaTesterDashboard";
import BusinessDashboard from "./pages/BusinessDashboard";
import RoleManagement from "./pages/RoleManagement";
import TierManagement from "./pages/TierManagement";
import Settings from "./pages/Settings";
import Wallet from "./pages/Wallet";
import Transactions from "./pages/Transactions";
import TransactionList from "./pages/TransactionList";
import VirtualCardNew from "./pages/VirtualCardNew";
import VirtualCardDetails from "./pages/VirtualCardDetails";
import VirtualCardFund from "./pages/VirtualCardFund";
import Transfer from "./pages/Transfer";
import SendMoney from "./pages/SendMoney";
import Business from "./pages/Business";
import Compliance from "./pages/Compliance";
import FeedbackDashboard from "./pages/FeedbackDashboard";
import Feedback from "./pages/Feedback";
import Help from "./pages/Help";
import ResetPassword from "./pages/ResetPassword";
import UpdatePassword from "./pages/UpdatePassword";
import Pricing from "./pages/Pricing";
import Profile from "./pages/Profile";
import Checkout from "./pages/Checkout";
import SubscriptionTiers from "./pages/SubscriptionTiers";
import Billing from "./pages/Billing";
import Analytics from "./pages/Analytics";
import API from "./pages/API";
import Support from "./pages/Support";
import Rewards from "./pages/Rewards";
import BitcoinWallet from "./pages/BitcoinWallet";
import PaymentProcessor from "./pages/PaymentProcessor";
import PaymentServices from "./pages/PaymentServices";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFailed from "./pages/PaymentFailed";
import Disputes from "./pages/Disputes";
import Notifications from "./pages/Notifications";
import SecuritySettings from "./pages/SecuritySettings";
import TwoFactorAuth from "./pages/TwoFactorAuth";
import KycPage from "./pages/KycPage";
import UssdAccess from "./pages/UssdAccess";
import WalletReconciliationPage from "./pages/WalletReconciliationPage";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Blog from "./pages/Blog";
import Faq from "./pages/Faq";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import NotFound from "./pages/NotFound";
import MobileBottomNav from "@/components/MobileBottomNav";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <RoleProvider>
              <NotificationProvider>
                <MobileBottomNav />
                <Routes>
                  {/* Public routes */}
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/update-password" element={<UpdatePassword />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/subscription-tiers" element={<SubscriptionTiers />} />
                  <Route path="/checkout/*" element={<Checkout />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/blog" element={<Blog />} />
                  <Route path="/faq" element={<Faq />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                  <Route path="/terms-of-service" element={<TermsOfService />} />
                  <Route path="/payment-success" element={<PaymentSuccess />} />
                  <Route path="/payment-failed" element={<PaymentFailed />} />
                  
                  {/* Protected routes */}
                  <Route path="/dashboard" element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  } />
                  
                  {/* Role-specific dashboards */}
                  <Route path="/user-dashboard" element={
                    <ProtectedRoute>
                      <UserDashboard />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/admin-dashboard" element={
                    <ProtectedRoute>
                      <AdminDashboard />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/beta-dashboard" element={
                    <ProtectedRoute>
                      <BetaTesterDashboard />
                    </ProtectedRoute>
                  } />

                  <Route path="/business-dashboard" element={
                    <ProtectedRoute>
                      <BusinessRouteGuard>
                        <BusinessDashboard />
                      </BusinessRouteGuard>
                    </ProtectedRoute>
                  } />

                  <Route path="/business" element={
                    <ProtectedRoute>
                      <BusinessRouteGuard>
                        <Business />
                      </BusinessRouteGuard>
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/role-management" element={
                    <ProtectedRoute>
                      <RoleManagement />
                    </ProtectedRoute>
                  } />

                  <Route path="/tier-management" element={
                    <ProtectedRoute>
                      <TierManagement />
                    </ProtectedRoute>
                  } />

                  <Route path="/settings" element={
                    <ProtectedRoute>
                      <Settings />
                    </ProtectedRoute>
                  } />

                  <Route path="/security-settings" element={
                    <ProtectedRoute>
                      <SecuritySettings />
                    </ProtectedRoute>
                  } />

                  <Route path="/two-factor-auth" element={
                    <ProtectedRoute>
                      <TwoFactorAuth />
                    </ProtectedRoute>
                  } />

                  <Route path="/profile" element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  } />

                  <Route path="/wallet" element={
                    <ProtectedRoute>
                      <Wallet />
                    </ProtectedRoute>
                  } />

                  <Route path="/bitcoin-wallet" element={
                    <ProtectedRoute>
                      <BitcoinWallet />
                    </ProtectedRoute>
                  } />

                  <Route path="/wallet-reconciliation" element={
                    <ProtectedRoute>
                      <WalletReconciliationPage />
                    </ProtectedRoute>
                  } />

                  <Route path="/transactions" element={
                    <ProtectedRoute>
                      <Transactions />
                    </ProtectedRoute>
                  } />

                  <Route path="/transaction-list" element={
                    <ProtectedRoute>
                      <TransactionList />
                    </ProtectedRoute>
                  } />

                  <Route path="/billing" element={
                    <ProtectedRoute>
                      <Billing />
                    </ProtectedRoute>
                  } />

                  <Route path="/analytics" element={
                    <ProtectedRoute requiredFeature="analytics">
                      <Analytics />
                    </ProtectedRoute>
                  } />

                  <Route path="/api" element={
                    <ProtectedRoute requiredFeature="business_tools">
                      <API />
                    </ProtectedRoute>
                  } />

                  <Route path="/support" element={
                    <ProtectedRoute>
                      <Support />
                    </ProtectedRoute>
                  } />

                  <Route path="/card/new" element={
                    <ProtectedRoute>
                      <VirtualCardNew />
                    </ProtectedRoute>
                  } />

                  <Route path="/card/:id" element={
                    <ProtectedRoute>
                      <VirtualCardDetails />
                    </ProtectedRoute>
                  } />

                  <Route path="/card/:id/fund" element={
                    <ProtectedRoute>
                      <VirtualCardFund />
                    </ProtectedRoute>
                  } />

                  <Route path="/transfer" element={
                    <ProtectedRoute requiredFeature="transfers">
                      <Transfer />
                    </ProtectedRoute>
                  } />

                  <Route path="/send-money" element={
                    <ProtectedRoute>
                      <SendMoney />
                    </ProtectedRoute>
                  } />

                  <Route path="/compliance" element={
                    <ProtectedRoute>
                      <Compliance />
                    </ProtectedRoute>
                  } />

                  <Route path="/feedback-dashboard" element={
                    <ProtectedRoute requiredFeature="feedback_dashboard">
                      <FeedbackDashboard />
                    </ProtectedRoute>
                  } />

                  <Route path="/feedback" element={
                    <ProtectedRoute>
                      <Feedback />
                    </ProtectedRoute>
                  } />

                  <Route path="/help" element={
                    <ProtectedRoute>
                      <Help />
                    </ProtectedRoute>
                  } />

                  <Route path="/rewards" element={
                    <ProtectedRoute>
                      <Rewards />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/payment-processor" element={
                    <ProtectedRoute requiredFeature="business_tools">
                      <PaymentProcessor />
                    </ProtectedRoute>
                  } />

                  <Route path="/payment-services" element={
                    <ProtectedRoute>
                      <PaymentServices />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/disputes" element={
                    <ProtectedRoute>
                      <Disputes />
                    </ProtectedRoute>
                  } />

                  <Route path="/notifications" element={
                    <ProtectedRoute>
                      <Notifications />
                    </ProtectedRoute>
                  } />

                  <Route path="/kyc" element={
                    <ProtectedRoute>
                      <KycPage />
                    </ProtectedRoute>
                  } />

                  <Route path="/ussd-access" element={
                    <ProtectedRoute>
                      <UssdAccess />
                    </ProtectedRoute>
                  } />

                  {/* Catch-all 404 route */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </NotificationProvider>
            </RoleProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
