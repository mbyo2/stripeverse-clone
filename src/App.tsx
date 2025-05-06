
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import BusinessRouteGuard from './components/business/BusinessRouteGuard';
import ProtectedRoute from './components/ProtectedRoute';
import { Toaster } from "@/components/ui/toaster";
import BetaBanner from './components/BetaBanner';
import { AuthProvider } from './contexts/AuthContext';

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
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentFailed from './pages/PaymentFailed';
import PaymentServices from "@/pages/PaymentServices";
import Faq from './pages/Faq';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import BusinessDashboard from './pages/BusinessDashboard';
import Transactions from './pages/Transactions';
import Feedback from './pages/Feedback';
import Profile from './pages/Profile';

function App() {
  return (
    <>
      <AuthProvider>
        <div className="app">
          <BetaBanner expiryDays={7} version="0.0.1" />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/checkout" element={
              <ProtectedRoute>
                <Checkout />
              </ProtectedRoute>
            } />
            <Route path="/wallet" element={
              <ProtectedRoute>
                <Wallet />
              </ProtectedRoute>
            } />
            <Route path="/transfer" element={
              <ProtectedRoute>
                <SendMoney />
              </ProtectedRoute>
            } />
            <Route path="/compliance" element={
              <ProtectedRoute>
                <Compliance />
              </ProtectedRoute>
            } />
            <Route path="/ussd-access" element={
              <ProtectedRoute>
                <UssdAccess />
              </ProtectedRoute>
            } />
            <Route path="/payment-success" element={
              <ProtectedRoute>
                <PaymentSuccess />
              </ProtectedRoute>
            } />
            <Route path="/payment-failed" element={
              <ProtectedRoute>
                <PaymentFailed />
              </ProtectedRoute>
            } />
            <Route path="/payment-services" element={
              <ProtectedRoute>
                <PaymentServices />
              </ProtectedRoute>
            } />
            <Route path="/transactions" element={
              <ProtectedRoute>
                <Transactions />
              </ProtectedRoute>
            } />
            <Route path="/feedback" element={
              <ProtectedRoute>
                <Feedback />
              </ProtectedRoute>
            } />
            
            <Route 
              path="/business-dashboard" 
              element={
                <BusinessRouteGuard>
                  <BusinessDashboard />
                </BusinessRouteGuard>
              } 
            />
            
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </div>
      </AuthProvider>
    </>
  );
}

export default App;
