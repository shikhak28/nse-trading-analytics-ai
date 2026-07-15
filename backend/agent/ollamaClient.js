const { Ollama } = require("ollama");

// Free, local-first by design (see project notes): points at a local Ollama
// daemon by default. OLLAMA_HOST lets it point elsewhere (e.g. a
// self-hosted Ollama box) without code changes.
const ollama = new Ollama({ host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434" });

module.exports = ollama;
