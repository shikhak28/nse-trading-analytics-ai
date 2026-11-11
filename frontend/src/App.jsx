
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./context/ThemeContext";
import ConnectZerodha from "./components/Auth/ConnectZerodha";
import AppLayout from "./components/AppLayout";
import { lazy } from "react";

// Each page loads only when opened, so the first visit doesn't download
// every page (and its chart libraries) up front.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const Market = lazy(() => import("./pages/Market"));
const Agent = lazy(() => import("./pages/Agent"));
const Trading = lazy(() => import("./pages/Trading"));
const History = lazy(() => import("./pages/History"));
const Profile = lazy(() => import("./pages/Profile"));
const Predictions = lazy(() => import("./pages/Predictions"));
const PriceGroupPredictions = lazy(() => import("./pages/PriceGroupPredictions"));
const Verification = lazy(() => import("./pages/Verification"));
const Accuracy = lazy(() => import("./pages/Accuracy"));
const ModelHealth = lazy(() => import("./pages/ModelHealth"));
const TrendStocks = lazy(() => import("./pages/TrendStocks"));

function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/market" element={<Market />} />
        <Route path="/trading" element={<Trading />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:symbol" element={<History />} />
        <Route path="/predictions" element={<Predictions />} />
        <Route path="/price-groups" element={<PriceGroupPredictions />} />
        <Route path="/trends" element={<TrendStocks />} />
        <Route path="/verification" element={<Verification />} />
        <Route path="/accuracy" element={<Accuracy />} />
        <Route path="/model-health" element={<ModelHealth />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AppShell() {
  const { isAuthenticated, loading, setIsAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mb-4 h-10 w-10 rounded-full border-4 border-blue-400 border-t-transparent animate-spin mx-auto"></div>
          <p className="text-lg font-semibold">Checking your Zerodha connection...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? (
    <AuthenticatedRoutes />
  ) : (
    <ConnectZerodha onConnected={() => setIsAuthenticated(true)} />
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
