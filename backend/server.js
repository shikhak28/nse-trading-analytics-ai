const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env"),
  override: true,
});
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth.routes");
const marketRoutes = require("./routes/market.routes");
const agentRoutes = require("./routes/agent.routes");
const portfolioRoutes = require("./routes/portfolio.routes");
const gttRoutes = require("./routes/gtt.routes");
const ordersRoutes = require("./routes/orders.routes");
const marketSocket = require("./realtime/marketSocket");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/market", marketRoutes);
app.use("/agent", agentRoutes);
app.use("/portfolio", portfolioRoutes);
app.use("/gtt", gttRoutes);
app.use("/orders", ordersRoutes);

/**
 * Health Check
 */
app.get("/", (req, res) => {
    res.json({
        status: "Backend Running",
        timestamp: new Date()
    });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || "http://localhost:5173" },
});
marketSocket.attach(io);

async function startServer() {
    try {
        const PORT = process.env.PORT || 5000;

        httpServer.listen(PORT, () => {
            console.log(` Backend running on port ${PORT}`);
        });

    } catch (err) {
        console.error("Failed to start server");
        console.error(err);
        process.exit(1);
    }
}

startServer();
