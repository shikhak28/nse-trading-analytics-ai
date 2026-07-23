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

  fetchMoversRange: async ({ min, max, exchange, limit } = {}) => {
    const params = { min, max };
    if (exchange) params.exchange = exchange;
    if (limit) params.limit = limit;
    const { data } = await client.get("/market/movers/range", { params });
    return data;
  },

  fetchMoversHistoryDates: async () => {
    const { data } = await client.get("/market/movers/history/dates");
    return data;
  },

  fetchMoversHistory: async (date, type, limit) => {
    const params = { date, type };
    if (limit) params.limit = limit;
    const { data } = await client.get("/market/movers/history", { params });
    return data;
  },

  fetchDepthSummary: async () => {
    const { data } = await client.get("/market/depth/summary");
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

  getGTTs: async () => {
    const { data } = await client.get("/gtt");
    return data;
  },

  createGTT: async (payload) => {
    const { data } = await client.post("/gtt", payload);
    return data;
  },

  deleteGTT: async (triggerId) => {
    const { data } = await client.delete(`/gtt/${triggerId}`);
    return data;
  },

  modifyGTT: async (triggerId, payload) => {
    const { data } = await client.put(`/gtt/${triggerId}`, payload);
    return data;
  },

  getGttRules: async () => {
    const { data } = await client.get("/gtt/rules");
    return data;
  },

  createGttRule: async (payload) => {
    const { data } = await client.post("/gtt/rules", payload);
    return data;
  },

  updateGttRule: async (id, payload) => {
    const { data } = await client.put(`/gtt/rules/${id}`, payload);
    return data;
  },

  deleteGttRule: async (id) => {
    const { data } = await client.delete(`/gtt/rules/${id}`);
    return data;
  },

  getOrders: async () => {
    const { data } = await client.get("/orders");
    return data;
  },

  cancelOrder: async (variety, orderId) => {
    const { data } = await client.delete(`/orders/${variety}/${orderId}`);
    return data;
  },
};
