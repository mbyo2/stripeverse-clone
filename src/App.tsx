import React from 'react';
import { Route, Routes } from 'react-router-dom';
import BusinessRouteGuard from './components/business/BusinessRouteGuard';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import Pricing from './pages/Pricing';
import Blog from './pages/Blog';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Checkout from './pages/Checkout';
import Wallet from './pages/Wallet';
import SendMoney from './pages/SendMoney';
import Compliance from './pages/Compliance';
import UssdAccess from './pages/UssdAccess';
import NotFound from './pages/NotFound';
import { Toaster } from "@/components/ui/toaster"
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentFailed from './pages/PaymentFailed';
import PaymentServices from "@/pages/PaymentServices";
import Faq from './pages/Faq';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import BusinessDashboard from './pages/BusinessDashboard';
import BetaBanner from './components/BetaBanner';
import Transactions from './pages/Transactions';
import Feedback from './pages/Feedback';
import { AuthProvider } from './contexts/AuthContext';

function App() {
  return (
    <>
      <AuthProvider>
        <div className="app">
          <BetaBanner expiryDays={7} version="0.9.0" />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/transfer" element={<SendMoney />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/ussd-access" element={<UssdAccess />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/payment-failed" element={<PaymentFailed />} />
            <Route path="/payment-services" element={<PaymentServices />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/feedback" element={<Feedback />} />
            
            <Route path="/faq" element={<Faq />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            
            <Route 
              path="/business-dashboard" 
              element={
                <BusinessRouteGuard>
                  <BusinessDashboard />
                </BusinessRouteGuard>
              } 
            />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </div>
      </AuthProvider>
    </>
  );
}

export default App;
