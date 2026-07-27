const BASE_URL = "";

export const agentApi = {
  sendMessage: async (sessionId, message) => {
    const res = await fetch(`${BASE_URL}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sessionId, message }),
    });
    return res.json();
  },

  getHistory: async (sessionId) => {
    const res = await fetch(`${BASE_URL}/agent/conversations/${sessionId}`, { credentials: "include" });
    return res.json();
  },
};
