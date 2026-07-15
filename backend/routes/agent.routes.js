const express = require("express");

const router = express.Router();

const orchestrator = require("../agent/orchestrator");
const conversationService = require("../agent/conversation.service");

/**
 * Send a message to the AI trading agent and get its (tool-calling) reply.
 */
router.post("/chat", async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        if (!sessionId || !message) {
            return res.status(400).json({ success: false, message: "sessionId and message are required" });
        }

        const reply = await orchestrator.chat(sessionId, message);
        return res.json({ success: true, reply });
    } catch (err) {
        console.error("Agent chat error:", err);
        const isConnectionError = err.cause?.code === "ECONNREFUSED" || err.message === "fetch failed";
        const errorMessage = isConnectionError
            ? "Could not reach Ollama. Make sure it's installed and running (`ollama serve`), and that the model is pulled (`ollama pull llama3.1`)."
            : err.message || "Agent request failed";
        return res.status(500).json({ success: false, message: errorMessage });
    }
});

/**
 * Load a session's conversation history (for restoring the chat UI on reload).
 */
router.get("/conversations/:sessionId", async (req, res) => {
    try {
        const history = await conversationService.getHistory(req.params.sessionId);
        return res.json({ success: true, results: history });
    } catch (err) {
        console.error("Agent history error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
