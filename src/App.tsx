
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
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
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
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
      </Router>
    </AuthProvider>
  );
}

export default App;
