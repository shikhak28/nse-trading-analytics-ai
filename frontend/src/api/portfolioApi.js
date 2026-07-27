const BASE_URL = "";

export const portfolioApi = {
  getHoldings: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/holdings`, { credentials: "include" });
    return res.json();
  },

  getPositions: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/positions`, { credentials: "include" });
    return res.json();
  },

  getAuctions: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/holdings/auctions`, { credentials: "include" });
    return res.json();
  },

  convertPosition: async (params) => {
    const res = await fetch(`${BASE_URL}/portfolio/positions/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });
    return res.json();
  },
};
