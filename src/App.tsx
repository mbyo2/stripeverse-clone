
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import NotFound from "@/pages/NotFound";
import Wallet from "@/pages/Wallet";
import Transfer from "@/pages/Transfer";
import Transactions from "@/pages/Transactions";
import Checkout from "@/pages/Checkout";
import VirtualCardNew from "@/pages/VirtualCardNew";
import VirtualCardDetails from "@/pages/VirtualCardDetails";
import VirtualCardFund from "@/pages/VirtualCardFund";
import KycPage from "@/pages/KycPage";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import TermsOfService from "@/pages/TermsOfService";
import Compliance from "@/pages/Compliance";
import UssdAccess from "@/pages/UssdAccess";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "@/pages/Index";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/ussd-access" element={<UssdAccess />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wallet"
          element={
            <ProtectedRoute>
              <Wallet />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transfer"
          element={
            <ProtectedRoute>
              <Transfer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions"
          element={
            <ProtectedRoute>
              <Transactions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kyc"
          element={
            <ProtectedRoute>
              <KycPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/virtual-card/new"
          element={
            <ProtectedRoute>
              <VirtualCardNew />
            </ProtectedRoute>
          }
        />
        <Route
          path="/virtual-card/:id"
          element={
            <ProtectedRoute>
              <VirtualCardDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/virtual-card/fund/:id"
          element={
            <ProtectedRoute>
              <VirtualCardFund />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </AuthProvider>
  );
}

export default App;
