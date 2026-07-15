import { useEffect, useRef, useState } from "react";
import { agentApi } from "../api/agentApi";

const SUGGESTIONS = [
  "Compare TCS and Infosys",
  "Find stocks whose RSI is below 30",
  "Show breakout candidates",
  "Analyze the last 2 years of Reliance",
];

function getOrCreateSessionId() {
  let id = window.localStorage.getItem("agent_session_id");
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem("agent_session_id", id);
  }
  return id;
}

const Agent = () => {
  const [sessionId] = useState(getOrCreateSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await agentApi.getHistory(sessionId);
        if (data.success) {
          setMessages(data.results.filter((turn) => turn.role === "user" || turn.role === "assistant"));
        }
      } catch (err) {
        console.error("Failed to load agent history", err);
      } finally {
        setHistoryLoaded(true);
      }
    };

    loadHistory();
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const data = await agentApi.sendMessage(sessionId, text);
      const replyContent = data.success ? data.reply : `Error: ${data.message}`;
      setMessages((prev) => [...prev, { role: "assistant", content: replyContent }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 flex flex-col min-h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-1">AI Trading Agent</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
          Ask about stocks, trends, comparisons, or screens. Powered by a local Ollama model.
        </p>

        <div className="flex-1 overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4 mb-4 min-h-[420px]">
          {historyLoaded && messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-slate-400 dark:text-slate-500 text-sm">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={index} className={msg.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && <div className="text-slate-400 dark:text-slate-500 text-sm">Thinking...</div>}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && sendMessage(input)}
            placeholder="Ask about stocks, trends, or comparisons..."
            className="flex-1 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 outline-none focus:border-blue-400 text-slate-800 dark:text-slate-100"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading}
            className="rounded-2xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default Agent;
