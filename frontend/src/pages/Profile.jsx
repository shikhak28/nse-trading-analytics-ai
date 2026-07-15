import { useEffect, useState } from "react";
import { authApi } from "../api/authApi";
import { portfolioApi } from "../api/portfolioApi";
import TradingDetails from "../components/Profile/TradingDetails";

// Two per row (left, right / left, right ...) instead of one full-width row
// per field -- each field is its own tile with the label above the value.
const InfoGrid = ({ children }) => <div className="grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>;

const InfoField = ({ label, value }) => (
  <div>
    <p className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">{label}</p>
    <p className="font-medium text-slate-800 dark:text-slate-100 text-sm mt-1">{value ?? "-"}</p>
  </div>
);

const Profile = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const [holdings, setHoldings] = useState([]);
  const [positions, setPositions] = useState(null);
  const [auctions, setAuctions] = useState([]);
  const [tradingLoading, setTradingLoading] = useState(true);
  const [tradingError, setTradingError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await authApi.checkStatus();
        setStatus(data);
      } catch (err) {
        console.error("Failed to load profile status", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // Skip hitting the portfolio endpoints entirely if Zerodha isn't
  // connected -- they'd just 401 (loading is gated on the status check above
  // resolving first, since we need to know status?.connected).
  useEffect(() => {
    if (loading) return;
    if (!status?.connected) {
      setTradingLoading(false);
      return;
    }

    const load = async () => {
      setTradingLoading(true);
      setTradingError(null);
      try {
        const [holdingsRes, positionsRes, auctionsRes] = await Promise.all([
          portfolioApi.getHoldings(),
          portfolioApi.getPositions(),
          portfolioApi.getAuctions(),
        ]);

        if (!holdingsRes.success) throw new Error(holdingsRes.message || "Unable to load holdings.");
        if (!positionsRes.success) throw new Error(positionsRes.message || "Unable to load positions.");

        setHoldings(holdingsRes.results || []);
        setPositions(positionsRes.results || { net: [], day: [] });
        setAuctions(auctionsRes.success ? auctionsRes.results || [] : []);
      } catch (err) {
        setTradingError(err.message || "Unable to load trading details.");
      } finally {
        setTradingLoading(false);
      }
    };

    load();
  }, [loading, status?.connected]);

  if (loading) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading profile...</div>;
  }

  const profile = status?.profile;
  const user = status?.user;
  const tokenStatus = status?.tokenStatus;

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-1">Profile</h1>
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Account, Zerodha connection, and token status.</p>

      {/* Row 1: Account + Connection side by side. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mb-4">
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-3">Account</h2>
          <InfoGrid>
            <InfoField label="Name" value={profile?.user_name || user?.user_name} />
            <InfoField label="Email" value={profile?.email || user?.email} />
            <InfoField label="Broker" value={profile?.broker || user?.broker} />
            <InfoField label="Broker User ID" value={profile?.user_id || user?.broker_user_id} />
          </InfoGrid>
        </div>

        <div>
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-3">Connection</h2>
            <InfoGrid>
              <InfoField
                label="Login Status"
                value={
                  <span className={status?.connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {status?.connected ? "Connected" : "Disconnected"}
                  </span>
                }
              />
              <InfoField
                label="Token Status"
                value={
                  tokenStatus ? (
                    <span className={tokenStatus.is_valid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {tokenStatus.is_valid ? "Valid" : "Invalid / expired"}
                    </span>
                  ) : (
                    "No token issued yet"
                  )
                }
              />
              <InfoField label="Token Issued" value={tokenStatus?.generated_at ? new Date(tokenStatus.generated_at).toLocaleString() : "-"} />
            </InfoGrid>
          </div>

          {!status?.connected && (
            <div className="rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-6 text-amber-800 dark:text-amber-300 text-sm mt-4">
              Your Zerodha session is disconnected. Zerodha access tokens expire roughly once a day with no
              silent refresh -- reconnect from the login screen to continue.
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Holdings, Positions, Auctions together in their own row of 3
          (TradingDetails lays these out internally as a 3-column grid). */}
      {status?.connected ? (
        <TradingDetails
          holdings={holdings}
          positions={positions}
          auctions={auctions}
          loading={tradingLoading}
          error={tradingError}
        />
      ) : (
        <div className="rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-6 text-amber-800 dark:text-amber-300 text-sm">
          Connect your Zerodha account to see holdings, positions, and auctions here.
        </div>
      )}
    </div>
  );
};

export default Profile;
