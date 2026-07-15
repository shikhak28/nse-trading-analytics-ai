import { Outlet, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { authApi } from "../api/authApi";
import Sidebar from "./Sidebar";

const AppLayout = () => {
  const { setIsAuthenticated } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const handleLogout = async () => {
    await authApi.logout();
    window.localStorage.removeItem("zerodha_connected");
    setIsAuthenticated(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 px-6 py-3 backdrop-blur">
          <button
            onClick={toggleTheme}
            className="rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {isDark ? "Light mode" : "Dark mode"}
          </button>
          <Link
            to="/profile"
            className="rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Profile
          </Link>
          <button
            onClick={handleLogout}
            className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition"
          >
            Logout
          </button>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
