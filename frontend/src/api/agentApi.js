const BASE_URL = "http://localhost:5000";

export const agentApi = {
  sendMessage: async (sessionId, message) => {
    const res = await fetch(`${BASE_URL}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
    });
    return res.json();
  },

  getHistory: async (sessionId) => {
    const res = await fetch(`${BASE_URL}/agent/conversations/${sessionId}`);
    return res.json();
  },
};
