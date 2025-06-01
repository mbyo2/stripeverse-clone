
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RoleProvider } from "@/contexts/RoleContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import SessionTimeoutWarning from "@/components/SessionTimeoutWarning";
import ProtectedRoute from "@/components/ProtectedRoute";
import BusinessRouteGuard from "@/components/business/BusinessRouteGuard";
import Index from "./pages/Index";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import UpdatePassword from "./pages/UpdatePassword";
import Dashboard from "./pages/Dashboard";
import Wallet from "./pages/Wallet";
import Transfer from "./pages/Transfer";
import TransactionList from "./pages/TransactionList";
import Settings from "./pages/Settings";
import TwoFactorAuth from "./pages/TwoFactorAuth";
import Profile from "./pages/Profile";
import Help from "./pages/Help";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Pricing from "./pages/Pricing";
import PaymentServices from "./pages/PaymentServices";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Faq from "./pages/Faq";
import NotFound from "./pages/NotFound";
import Checkout from "./pages/Checkout";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFailed from "./pages/PaymentFailed";
import SendMoney from "./pages/SendMoney";
import Transactions from "./pages/Transactions";
import BusinessDashboard from "./pages/BusinessDashboard";
import VirtualCardNew from "./pages/VirtualCardNew";
import VirtualCardDetails from "./pages/VirtualCardDetails";
import VirtualCardFund from "./pages/VirtualCardFund";
import KycPage from "./pages/KycPage";
import Compliance from "./pages/Compliance";
import UssdAccess from "./pages/UssdAccess";
import SubscriptionTiers from "./pages/SubscriptionTiers";
import Notifications from "./pages/Notifications";
import Feedback from "./pages/Feedback";
import FeedbackDashboard from "./pages/FeedbackDashboard";
import Blog from "./pages/Blog";

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
                <SessionTimeoutWarning />
                <Routes>
                  {/* Public routes */}
                  <Route path="/" element={<Index />} />
                  <Route path="/home" element={<Home />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/payment-services" element={<PaymentServices />} />
                  <Route path="/terms" element={<TermsOfService />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/faq" element={<Faq />} />
                  <Route path="/blog" element={<Blog />} />
                  <Route path="/ussd" element={<UssdAccess />} />
                  
                  {/* Auth routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/update-password" element={<UpdatePassword />} />
                  
                  {/* Payment routes */}
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/payment/success" element={<PaymentSuccess />} />
                  <Route path="/payment/failed" element={<PaymentFailed />} />
                  
                  {/* Protected routes */}
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  <Route path="/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
                  <Route path="/transfer" element={<ProtectedRoute><Transfer /></ProtectedRoute>} />
                  <Route path="/send-money" element={<ProtectedRoute><SendMoney /></ProtectedRoute>} />
                  <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
                  <Route path="/transaction-list" element={<ProtectedRoute><TransactionList /></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                  <Route path="/2fa" element={<ProtectedRoute><TwoFactorAuth /></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/help" element={<ProtectedRoute><Help /></ProtectedRoute>} />
                  <Route path="/kyc" element={<ProtectedRoute><KycPage /></ProtectedRoute>} />
                  <Route path="/compliance" element={<ProtectedRoute><Compliance /></ProtectedRoute>} />
                  <Route path="/subscription-tiers" element={<ProtectedRoute><SubscriptionTiers /></ProtectedRoute>} />
                  <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                  <Route path="/feedback" element={<ProtectedRoute><Feedback /></ProtectedRoute>} />
                  
                  {/* Virtual card routes */}
                  <Route path="/cards/new" element={<ProtectedRoute><VirtualCardNew /></ProtectedRoute>} />
                  <Route path="/cards/:id" element={<ProtectedRoute><VirtualCardDetails /></ProtectedRoute>} />
                  <Route path="/cards/:id/fund" element={<ProtectedRoute><VirtualCardFund /></ProtectedRoute>} />
                  
                  {/* Business routes */}
                  <Route path="/business-dashboard" element={
                    <ProtectedRoute>
                      <BusinessRouteGuard>
                        <BusinessDashboard />
                      </BusinessRouteGuard>
                    </ProtectedRoute>
                  } />
                  <Route path="/feedback-dashboard" element={
                    <ProtectedRoute>
                      <BusinessRouteGuard>
                        <FeedbackDashboard />
                      </BusinessRouteGuard>
                    </ProtectedRoute>
                  } />
                  
                  {/* 404 */}
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
