export const api = {
  getMarkets: async () => {
    const res = await fetch("/stocks", { credentials: "include" });
    return res.json();
  },
};
