import axios from "axios";

// baseURL is relative -- rides the Vite dev proxy (see vite.config.js) so
// the browser sees these calls as same-origin, letting the session cookie
// flow without needing cross-site cookie settings. withCredentials sends it.
const client = axios.create({ baseURL: "", withCredentials: true });

export const predictionsApi = {
  getPredictions: async ({ horizon, date, symbol, exchange, limit } = {}) => {
    const params = {};
    if (horizon) params.horizon = horizon;
    if (date) params.date = date;
    if (symbol) params.symbol = symbol;
    if (exchange) params.exchange = exchange;
    if (limit) params.limit = limit;
    const { data } = await client.get("/predictions", { params });
    return data;
  },

  getRankings: async ({ date, category } = {}) => {
    const params = {};
    if (date) params.date = date;
    if (category) params.category = category;
    const { data } = await client.get("/ranking", { params });
    return data;
  },
};
