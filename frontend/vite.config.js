import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxies API calls to the backend so the browser sees everything as
    // same-origin (:5173) -- needed for the session cookie to flow without
    // fighting SameSite/cross-site cookie rules in local dev (different
    // ports count as cross-site even on localhost). See
    // backend/server.js's session middleware + cors config.
    proxy: {
      "/auth": "http://localhost:5000",
      "/market": "http://localhost:5000",
      "/portfolio": "http://localhost:5000",
      "/gtt": "http://localhost:5000",
      "/orders": "http://localhost:5000",
      "/agent": "http://localhost:5000",
      "/stocks": "http://localhost:5000",
    },
  },
})
