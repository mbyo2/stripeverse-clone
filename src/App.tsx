
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import Index from "@/pages/Index";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Checkout from "@/pages/Checkout";
import NotFound from "@/pages/NotFound";
import Wallet from "@/pages/Wallet";
import Transfer from "@/pages/Transfer";
import Transactions from "@/pages/Transactions";
import SendMoney from "@/pages/SendMoney";
import UssdAccess from "@/pages/UssdAccess";
import VirtualCardNew from "@/pages/VirtualCardNew";
import VirtualCardDetails from "@/pages/VirtualCardDetails";
import VirtualCardFund from "@/pages/VirtualCardFund";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Index />} />
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
            path="/send-money"
            element={
              <ProtectedRoute>
                <SendMoney />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ussd-access"
            element={
              <ProtectedRoute>
                <UssdAccess />
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
            path="/virtual-card/fund"
            element={
              <ProtectedRoute>
                <VirtualCardFund />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
      <Toaster />
    </AuthProvider>
  );
}

export default App;
