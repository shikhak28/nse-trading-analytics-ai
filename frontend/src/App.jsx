
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./context/ThemeContext";
import ConnectZerodha from "./components/Auth/ConnectZerodha";
import AppLayout from "./components/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import Market from "./pages/Market";
import Agent from "./pages/Agent";
import Trading from "./pages/Trading";
import History from "./pages/History";
import Profile from "./pages/Profile";

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
