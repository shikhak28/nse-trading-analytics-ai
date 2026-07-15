import { io } from "socket.io-client";

const BASE_URL = "http://localhost:5000";

export const socket = io(BASE_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});
