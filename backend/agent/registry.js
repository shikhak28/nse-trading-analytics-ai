const getHistoricalData = require("./tools/getHistoricalData.tool");
const compareStocks = require("./tools/compareStocks.tool");
const calculateIndicator = require("./tools/calculateIndicator.tool");
const screenByRsi = require("./tools/screenByRsi.tool");
const findBreakouts = require("./tools/findBreakouts.tool");
const scanVolume = require("./tools/scanVolume.tool");
const growthAfterThreshold = require("./tools/growthAfterThreshold.tool");

// Adding a new tool is: write a file in ./tools with { name, description,
// parameters, execute() }, then list it here.
const tools = [getHistoricalData, compareStocks, calculateIndicator, screenByRsi, findBreakouts, scanVolume, growthAfterThreshold];

const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

/**
 * Ollama's /api/chat tool format (OpenAI-style function-calling shape).
 */
function getToolDefinitions() {
    return tools.map(({ name, description, parameters }) => ({
        type: "function",
        function: { name, description, parameters },
    }));
}

async function executeTool(name, input) {
    const tool = toolsByName[name];
    if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
    }
    return tool.execute(input || {});
}

module.exports = { getToolDefinitions, executeTool };
