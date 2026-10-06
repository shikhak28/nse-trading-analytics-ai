import axios from "axios";

// baseURL is relative -- rides the Vite dev proxy (see vite.config.js) so
// the browser sees these calls as same-origin, letting the session cookie
// flow without needing cross-site cookie settings. withCredentials sends it.
const client = axios.create({ baseURL: "", withCredentials: true });

export const predictionsApi = {
  getPredictions: async ({ horizon, date, symbol, exchange, sector, limit } = {}) => {
    const params = {};
    if (horizon) params.horizon = horizon;
    if (date) params.date = date;
    if (symbol) params.symbol = symbol;
    if (exchange) params.exchange = exchange;
    if (sector) params.sector = sector;
    if (limit) params.limit = limit;
    const { data } = await client.get("/api/predictions", { params });
    return data;
  },

  getSectors: async () => {
    const { data } = await client.get("/api/predictions/sectors");
    return data;
  },

  getRankings: async ({ date, category } = {}) => {
    const params = {};
    if (date) params.date = date;
    if (category) params.category = category;
    const { data } = await client.get("/ranking", { params });
    return data;
  },

  getVerification: async ({ symbol, exchange, checkpoint, from, to, limit, offset } = {}) => {
    const params = {};
    if (symbol) params.symbol = symbol;
    if (exchange) params.exchange = exchange;
    if (checkpoint) params.checkpoint = checkpoint;
    if (from) params.from = from;
    if (to) params.to = to;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const { data } = await client.get("/api/verification", { params });
    return data;
  },

  getAccuracy: async ({ groupBy, horizon, targetLabel } = {}) => {
    const params = {};
    if (groupBy) params.groupBy = groupBy;
    if (horizon) params.horizon = horizon;
    if (targetLabel) params.targetLabel = targetLabel;
    const { data } = await client.get("/api/accuracy", { params });
    return data;
  },

  getCurrentModel: async (horizon) => {
    const params = {};
    if (horizon) params.horizon = horizon;
    const { data } = await client.get("/model", { params });
    return data;
  },

  getModelVersions: async (horizon) => {
    const params = {};
    if (horizon) params.horizon = horizon;
    const { data } = await client.get("/model/versions", { params });
    return data;
  },
};
