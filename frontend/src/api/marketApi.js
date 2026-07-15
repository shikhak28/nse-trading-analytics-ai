import axios from "axios";

const client = axios.create({ baseURL: "http://localhost:5000" });

export const marketApi = {
  getMarkets: async () => {
    const { data } = await client.get("/stocks");
    return data;
  },

  getCompanies: async ({ search, limit, offset } = {}) => {
    const params = {};
    if (search) params.search = search;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const { data } = await client.get("/market/companies", { params });
    return data;
  },

  fetchHistoricalSummary: async () => {
    const { data } = await client.get("/market/historical/summary");
    return data;
  },

  fetchStoredHistorical: async (symbol, interval = "day", from, to) => {
    const params = { symbol, interval };
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await client.get("/market/historical/stored", { params });
    return data;
  },

  syncHistorical: async (symbols, interval = "day", from, to) => {
    const params = { symbols, interval };
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await client.post("/market/historical/sync", null, { params });
    return data;
  },

  fetchMovers: async (type, limit) => {
    const params = { type };
    if (limit) params.limit = limit;
    const { data } = await client.get("/market/movers", { params });
    return data;
  },

  fetchStoredDepth: async (symbol, exchange, from, to, limit) => {
    const params = { symbol, exchange };
    if (from) params.from = from;
    if (to) params.to = to;
    if (limit) params.limit = limit;
    const { data } = await client.get("/market/depth/stored", { params });
    return data;
  },
};
