import { authApi } from "../api/authApi";

const LoginPage = () => {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#0f172a,_#111827_48%,_#030712)] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-700/70 bg-slate-900/80 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm uppercase tracking-[0.3em] text-blue-400">Stock Platform</p>
        <h1 className="mt-3 text-4xl font-semibold">Connect your Zerodha account</h1>
        <p className="mt-3 text-base text-slate-300">
          Sign in securely with Zerodha to unlock live market data and continue to the dashboard.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-800/80 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 text-xl">🔐</div>
            <div>
              <p className="font-semibold">Secure OAuth login</p>
              <p className="text-sm text-slate-400">You will be redirected to Zerodha for authentication.</p>
            </div>
          </div>
        </div>

        <button
          onClick={authApi.connect}
          className="mt-8 w-full rounded-2xl bg-blue-600 px-6 py-3 text-lg font-semibold text-white transition hover:bg-blue-500"
        >
          Connect Zerodha
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
