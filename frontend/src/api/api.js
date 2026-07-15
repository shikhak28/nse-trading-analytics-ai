export const api = {
  getMarkets: async () => {
    const res = await fetch("http://localhost:5000/stocks");
    return res.json();
  },
};
