
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
import RoleManagement from "./pages/RoleManagement";
import TierManagement from "./pages/TierManagement";
import Settings from "./pages/Settings";
import Wallet from "./pages/Wallet";
import Transactions from "./pages/Transactions";
import VirtualCardNew from "./pages/VirtualCardNew";
import Transfer from "./pages/Transfer";
import Business from "./pages/Business";
import Compliance from "./pages/Compliance";
import FeedbackDashboard from "./pages/FeedbackDashboard";
import Help from "./pages/Help";
import ResetPassword from "./pages/ResetPassword";
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
import NotFound from "./pages/NotFound";

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
                <Routes>
                  {/* Public routes */}
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/subscription-tiers" element={<SubscriptionTiers />} />
                  <Route path="/checkout/*" element={<Checkout />} />
                  
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

                  <Route path="/transactions" element={
                    <ProtectedRoute>
                      <Transactions />
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

                  <Route path="/transfer" element={
                    <ProtectedRoute requiredFeature="transfers">
                      <Transfer />
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
