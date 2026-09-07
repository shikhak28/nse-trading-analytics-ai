import { io } from "socket.io-client";

// No explicit URL -- connects same-origin, riding the Vite dev proxy locally
// (see vite.config.js's "/socket.io" entry) and nginx's reverse proxy in
// production (see deploy/nginx.conf's /socket.io/ location). A hardcoded
// "http://localhost:5000" only ever worked when browsing from the same
// machine the backend runs on -- broken for any real visitor.
export const socket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});
