const axios = require("axios");

// Google Gemini (free tier) for reading documents. Key: GEMINI_API_KEY in
// .env (aistudio.google.com > Get API key). GEMINI_MODEL picks the model.
const DEFAULT_MODEL = "gemini-2.5-flash";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

function modelName() {
    return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/**
 * Sends a PDF and a prompt, and returns the JSON object Gemini produces for
 * `schema` (an OpenAPI-style schema, as Gemini's responseSchema expects).
 */
async function readPdfAsJson({ pdf, prompt, schema }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set on the server."), { status: 503 });

    let res;
    try {
        res = await axios.post(
            `${API}/${encodeURIComponent(modelName())}:generateContent`,
            {
                contents: [
                    {
                        parts: [{ inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } }, { text: prompt }],
                    },
                ],
                generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema },
            },
            { headers: { "x-goog-api-key": key }, timeout: 180 * 1000, maxBodyLength: Infinity }
        );
    } catch (err) {
        const status = err.response?.status;
        const message = err.response?.data?.error?.message || err.message;
        // 429 = free-tier limit reached; tell the user plainly.
        const friendly = status === 429 ? "Gemini free limit reached for now. Try again in a minute (or tomorrow)." : `Gemini error: ${message}`;
        throw Object.assign(new Error(friendly), { status: status === 429 ? 429 : 502 });
    }

    const text = res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error("Gemini did not return a readable answer. Try again."), { status: 502 });
    }
}

module.exports = { readPdfAsJson, modelName };
