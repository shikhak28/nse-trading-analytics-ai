const BASE_URL = "http://localhost:5000";

export const portfolioApi = {
  getHoldings: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/holdings`);
    return res.json();
  },

  getPositions: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/positions`);
    return res.json();
  },

  getAuctions: async () => {
    const res = await fetch(`${BASE_URL}/portfolio/holdings/auctions`);
    return res.json();
  },

  convertPosition: async (params) => {
    const res = await fetch(`${BASE_URL}/portfolio/positions/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.json();
  },
};
