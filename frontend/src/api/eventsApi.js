import axios from "axios";

const client = axios.create({ baseURL: "", withCredentials: true });

export const eventsApi = {
  getUpcoming: async ({ days = 30, all = false } = {}) => {
    const { data } = await client.get("/api/events/upcoming", { params: { days, all: all ? 1 : undefined } });
    return data;
  },

  // Sends the CSV file's text; the backend parses and stores it.
  uploadCsv: async (text) => {
    const { data } = await client.post("/api/events/upload", text, { headers: { "Content-Type": "text/csv" } });
    return data;
  },
};
