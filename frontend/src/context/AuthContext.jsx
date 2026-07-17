import { createContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/authApi";

// Deliberately defined in this same file rather than a separate
// authContext.js -- a same-directory pair differing only by case
// (authContext.js / AuthContext.jsx) resolves fine on Linux's
// case-sensitive filesystem but silently resolves to the wrong file on
// Windows/macOS's default case-insensitive filesystem, which broke this
// exact import on a Windows machine.
export const AuthContext = createContext(null);

// Zerodha tokens have no refresh flow and can be invalidated mid-session
// (e.g. a Kite API call elsewhere returns a 403). Re-checking periodically
// means an expired token surfaces the reconnect screen on its own instead
// of only being caught on the next full page reload.
const STATUS_RECHECK_INTERVAL_MS = 60000;

export const AuthProvider = ({ children }) => {
  const initialAuth =
    typeof window !== "undefined" &&
    window.localStorage.getItem("zerodha_connected") === "true";

  const [isAuthenticated, setIsAuthenticated] = useState(initialAuth);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyConnection = async () => {
      try {
        const data = await authApi.checkStatus();
        const connected = data.connected || data.authenticated;

        setIsAuthenticated(connected);
        if (connected) {
          window.localStorage.setItem("zerodha_connected", "true");
        } else {
          window.localStorage.removeItem("zerodha_connected");
        }
      } catch (err) {
        console.error("Authentication check failed:", err);
        setIsAuthenticated(false);
        window.localStorage.removeItem("zerodha_connected");
      } finally {
        setLoading(false);
      }
    };

    verifyConnection();
    const interval = setInterval(verifyConnection, STATUS_RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, setIsAuthenticated, loading }),
    [isAuthenticated, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};