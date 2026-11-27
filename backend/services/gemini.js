const axios = require("axios");

// Google Gemini (free tier) for reading documents. Key: GEMINI_API_KEY in
// .env (aistudio.google.com > Get API key).
// Tried in order; the next one is used when a model is busy (503), retired
// (404), rate-limited (429) or too slow. GEMINI_MODEL, if set, goes first.
const MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta/models";

function modelList() {
    const first = process.env.GEMINI_MODEL;
    return first ? [first, ...MODELS.filter((m) => m !== first)] : MODELS;
}

function modelName() {
    return modelList()[0];
}

/**
 * Sends a PDF and a prompt, and returns { json, model }: the JSON object
 * Gemini produces for `schema` (an OpenAPI-style schema, as Gemini's
 * responseSchema expects) and the model that answered.
 */
async function readPdfAsJson({ pdf, prompt, schema }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set on the server."), { status: 503 });

    const body = {
        contents: [{ parts: [{ inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } }, { text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema },
    };
    let lastError;
    for (const model of modelList()) {
        let res;
        try {
            res = await axios.post(`${API}/${encodeURIComponent(model)}:generateContent`, body, {
                headers: { "x-goog-api-key": key },
                timeout: 75 * 1000, // x3 models stays under the page's 4-minute wait
                maxBodyLength: Infinity,
            });
        } catch (err) {
            const status = err.response?.status;
            lastError = { status, message: err.response?.data?.error?.message || err.message };
            if (!status || [404, 429, 500, 503].includes(status)) continue; // try the next model
            throw Object.assign(new Error(`Gemini error: ${lastError.message}`), { status: 502 });
        }
        const text = res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        try {
            return { json: JSON.parse(text), model };
        } catch {
            lastError = { status: 502, message: "unreadable answer" };
        }
    }
    const friendly =
        lastError?.status === 429
            ? "Gemini free limit reached for now. Try again in a minute (or tomorrow)."
            : "Gemini is busy right now. Try again in a few minutes.";
    throw Object.assign(new Error(friendly), { status: lastError?.status === 429 ? 429 : 503 });
}

module.exports = { readPdfAsJson, modelName };
