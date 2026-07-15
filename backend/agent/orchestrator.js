const ollama = require("./ollamaClient");
const { getToolDefinitions, executeTool } = require("./registry");
const conversationService = require("./conversation.service");
const db = require("../config/db");

const MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const MAX_TOOL_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are an AI trading analysis assistant for an Indian (NSE) stock platform.
You have tools to fetch historical price data, compare stocks, calculate technical indicators
(RSI, SMA), and screen the tracked stock universe for RSI conditions, breakouts, and volume trends.
Always use a tool to get real data before answering questions about specific stocks or screens --
never guess prices or indicator values. If a tool reports no stored data for a symbol, tell the user
it likely hasn't been synced yet rather than making something up. Keep answers concise and concrete,
citing the actual numbers the tools returned.`;

async function recordAnalysisResult(toolName, args, result) {
    const screeningTools = new Set(["screen_by_rsi", "find_breakouts", "scan_increasing_volume", "compare_stocks"]);
    if (!screeningTools.has(toolName)) {
        return;
    }

    const symbolsInvolved = Array.isArray(result?.matches)
        ? result.matches.map((match) => match.symbol)
        : Array.isArray(args?.symbols)
            ? args.symbols.map((symbol) => symbol.toUpperCase())
            : [];

    await db.query(
        `INSERT INTO agent_analysis_results(query_text, result_type, result_json, symbols_involved)
         VALUES ($1, $2, $3, $4)`,
        [JSON.stringify(args), toolName, JSON.stringify(result), symbolsInvolved]
    );
}

function toOllamaMessages(history) {
    return history.map((turn) => ({
        role: turn.role,
        content: turn.content || "",
        ...(turn.tool_calls ? { tool_calls: turn.tool_calls } : {}),
    }));
}

/**
 * Runs one user turn through the tool-calling loop: ask the model, execute
 * any tools it requests, feed results back, repeat until it gives a final
 * text answer (or the iteration cap is hit).
 */
async function chat(sessionId, userMessage) {
    await conversationService.appendMessage(sessionId, "user", userMessage);
    const history = await conversationService.getHistory(sessionId);

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...toOllamaMessages(history)];

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
        iterations += 1;

        const response = await ollama.chat({
            model: MODEL,
            messages,
            tools: getToolDefinitions(),
        });

        const { message } = response;

        if (!message.tool_calls || message.tool_calls.length === 0) {
            await conversationService.appendMessage(sessionId, "assistant", message.content);
            return message.content;
        }

        messages.push({ role: "assistant", content: message.content || "", tool_calls: message.tool_calls });
        await conversationService.appendMessage(sessionId, "assistant", message.content || "", message.tool_calls);

        for (const toolCall of message.tool_calls) {
            const { name, arguments: args } = toolCall.function;
            let result;
            try {
                result = await executeTool(name, args);
                await recordAnalysisResult(name, args, result);
            } catch (err) {
                result = { error: err.message };
            }

            const toolResultContent = JSON.stringify(result);
            messages.push({ role: "tool", content: toolResultContent });
            await conversationService.appendMessage(sessionId, "tool", toolResultContent);
        }
    }

    const fallback = "I wasn't able to finish that analysis in the allotted steps. Try narrowing your question.";
    await conversationService.appendMessage(sessionId, "assistant", fallback);
    return fallback;
}

module.exports = { chat };
