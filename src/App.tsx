
import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import LazyLoad from "@/components/LazyLoad";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import BusinessRouteGuard from "@/components/business/BusinessRouteGuard";
import { NotificationProvider } from "@/contexts/NotificationContext";

// Lazy-loaded components
const Home = lazy(() => import("@/pages/Home"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const About = lazy(() => import("@/pages/About"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Contact = lazy(() => import("@/pages/Contact"));
const Faq = lazy(() => import("@/pages/Faq"));
const Blog = lazy(() => import("@/pages/Blog"));
const PaymentServices = lazy(() => import("@/pages/PaymentServices"));
const TermsOfService = lazy(() => import("@/pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const UpdatePassword = lazy(() => import("@/pages/UpdatePassword"));
const Wallet = lazy(() => import("@/pages/Wallet"));
const Profile = lazy(() => import("@/pages/Profile"));
const VirtualCardNew = lazy(() => import("@/pages/VirtualCardNew"));
const VirtualCardDetails = lazy(() => import("@/pages/VirtualCardDetails"));
const VirtualCardFund = lazy(() => import("@/pages/VirtualCardFund"));
const Transactions = lazy(() => import("@/pages/Transactions"));
const BusinessDashboard = lazy(() => import("@/pages/BusinessDashboard"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const PaymentSuccess = lazy(() => import("@/pages/PaymentSuccess"));
const PaymentFailed = lazy(() => import("@/pages/PaymentFailed"));
const SendMoney = lazy(() => import("@/pages/SendMoney"));
const Transfer = lazy(() => import("@/pages/Transfer"));
const Compliance = lazy(() => import("@/pages/Compliance"));
const KycPage = lazy(() => import("@/pages/KycPage"));
const Feedback = lazy(() => import("@/pages/Feedback"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const UssdAccess = lazy(() => import("@/pages/UssdAccess"));

function App() {
  return (
    <Router>
      <AuthProvider>
        <NotificationProvider>
          <Suspense fallback={<LazyLoad component={() => Promise.resolve({ default: () => <div>Loading...</div> })} />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/about" element={<About />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/blog" element={<Blog />} />
              <Route path="/services" element={<PaymentServices />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/checkout/:id" element={<Checkout />} />
              <Route path="/payment-success" element={<PaymentSuccess />} />
              <Route path="/payment-failed" element={<PaymentFailed />} />
              <Route path="/kyc" element={<KycPage />} />

              <Route element={<ProtectedRoute children={null} />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/card/new" element={<VirtualCardNew />} />
                <Route path="/card/:id" element={<VirtualCardDetails />} />
                <Route path="/card/:id/fund" element={<VirtualCardFund />} />
                <Route path="/send" element={<SendMoney />} />
                <Route path="/transfer" element={<Transfer />} />
                <Route path="/compliance" element={<Compliance />} />
                <Route path="/feedback" element={<Feedback />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/ussd" element={<UssdAccess />} />
              </Route>

              <Route element={<BusinessRouteGuard children={null} />}>
                <Route path="/business/*" element={<BusinessDashboard />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <Toaster />
        </NotificationProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
