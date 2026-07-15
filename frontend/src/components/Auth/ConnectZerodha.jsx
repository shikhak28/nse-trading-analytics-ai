import { useEffect, useState } from "react";

const ConnectZerodha = ({ onConnected }) => {
    const [status, setStatus] = useState({ connected: false, loading: true, message: "Checking connection..." });

    const checkConnection = async (justConnected = false) => {
        if (justConnected) {
            localStorage.setItem("zerodha_connected", "true");
            onConnected?.();
            setStatus({
                connected: true,
                loading: false,
                message: "Zerodha connected successfully. You can now access the dashboard.",
            });
            return;
        }

        try {
            const response = await fetch("http://localhost:5000/auth/status");
            const data = await response.json();

            if (data.connected) {
                localStorage.setItem("zerodha_connected", "true");
                onConnected?.();
                setStatus({
                    connected: true,
                    loading: false,
                    message: `Connected as ${data.profile?.user_name || "Zerodha user"}`,
                });
            } else {
                setStatus({
                    connected: false,
                    loading: false,
                    message: "Connect your Zerodha account to unlock live market data.",
                });
            }
        } catch (err) {
            console.error("Failed to check Zerodha connection:", err);
            setStatus({
                connected: false,
                loading: false,
                message: "Unable to reach the backend auth service.",
            });
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const justConnected = params.get("zerodha") === "connected";

        if (justConnected) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // One-time OAuth-redirect completion handler, not a per-render sync --
        // the immediate setState this triggers when justConnected is true is
        // intentional (finishing the login), not the re-render loop this rule
        // guards against.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        checkConnection(justConnected);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- checkConnection is redefined each render; adding it would loop
    }, [onConnected]);

    const handleConnect = () => {
        window.location.href = "http://localhost:5000/auth/login";
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#0f172a,_#111827_48%,_#030712)] text-white flex items-center justify-center px-4">
            <div className="w-full max-w-2xl rounded-3xl border border-slate-700/70 bg-slate-900/80 p-8 shadow-2xl backdrop-blur">
                <div className="mb-8">
                    <p className="text-sm uppercase tracking-[0.3em] text-blue-400">Stock Platform</p>
                    <h1 className="mt-3 text-4xl font-semibold">Welcome to your trading workspace</h1>
                    <p className="mt-3 text-base text-slate-300">
                        Connect your Zerodha account to unlock live market data and power the dashboard.
                    </p>
                </div>

                <div className="mb-8 rounded-2xl border border-slate-700 bg-slate-800/80 p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 text-xl">🔐</div>
                        <div>
                            <p className="font-semibold">Secure Zerodha login</p>
                            <p className="text-sm text-slate-400">You will be redirected to Zerodha for authentication.</p>
                        </div>
                    </div>
                </div>

                <div className="mb-8 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
                        <p className="font-semibold text-white">1. Login</p>
                        <p className="mt-1">Sign in to your Zerodha account.</p>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
                        <p className="font-semibold text-white">2. Authorize</p>
                        <p className="mt-1">Approve access for market data.</p>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
                        <p className="font-semibold text-white">3. Dashboard</p>
                        <p className="mt-1">Start exploring live insights.</p>
                    </div>
                </div>

                <button
                    onClick={handleConnect}
                    className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-lg font-semibold text-white transition hover:bg-blue-500"
                >
                    Connect Zerodha
                </button>

                <p className={`mt-4 text-sm font-medium ${status.connected ? "text-emerald-400" : "text-slate-300"}`}>
                    {status.loading ? "Checking connection..." : status.message}
                </p>
            </div>
        </div>
    );
};

export default ConnectZerodha;
