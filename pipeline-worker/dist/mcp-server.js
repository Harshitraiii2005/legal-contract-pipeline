"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const sdk_1 = require("./sdk");
const express_1 = __importDefault(require("express"));
// Initialize LexAI SDK
const sdk = new sdk_1.LexAIPipelineSDK();
// Create MCP Server
const server = new index_js_1.Server({
    name: 'lexai-pipeline-server',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Define tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'analyze_contract',
                description: 'Analyzes a legal contract text end-to-end through the multi-agent AI pipeline (extracts clauses, scores risks, checks compliance frameworks, and generates mitigated redlines).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        contractText: {
                            type: 'string',
                            description: 'The raw text content of the contract to analyze.',
                        },
                        contractName: {
                            type: 'string',
                            description: 'Name of the contract document.',
                        },
                        representedParty: {
                            type: 'string',
                            description: 'The party whose perspective is represented ("Client" or "Provider"). If omitted, it is auto-detected.',
                            enum: ['Client', 'Provider'],
                        },
                    },
                    required: ['contractText', 'contractName'],
                },
            },
        ],
    };
});
// Handle tool execution requests
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name !== 'analyze_contract') {
        throw new Error(`Tool not found: ${name}`);
    }
    const { contractText, contractName, representedParty } = args;
    if (!contractText || !contractText.trim()) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'Error: Contract text must not be empty.',
                },
            ],
            isError: true,
        };
    }
    try {
        const contractId = `mcp-${Date.now()}`;
        const result = await sdk.analyzeContract(contractId, contractName, contractText, representedParty);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result.report || result, null, 2),
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error executing contract analysis: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Start transport based on parameters
async function startServer() {
    const isSSE = process.argv.includes('--sse') || process.env.MCP_TRANSPORT === 'sse';
    if (isSSE) {
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        const activeTransports = {};
        app.get('/sse', async (req, res) => {
            console.log('[MCP Server] New SSE connection request');
            const transport = new sse_js_1.SSEServerTransport('/message', res);
            activeTransports[transport.sessionId] = transport;
            await server.connect(transport);
            transport.onclose = () => {
                console.log(`[MCP Server] Connection closed for session: ${transport.sessionId}`);
                delete activeTransports[transport.sessionId];
            };
        });
        app.post('/message', async (req, res) => {
            const sessionId = req.query.sessionId;
            console.log(`[MCP Server] Incoming POST message for session: ${sessionId}`);
            const transport = activeTransports[sessionId];
            if (!transport) {
                res.status(404).send('Session not found');
                return;
            }
            await transport.handlePostMessage(req, res, req.body);
        });
        const port = parseInt(process.env.MCP_PORT || '8081', 10);
        const host = process.env.MCP_HOST || '0.0.0.0';
        app.listen(port, host, () => {
            console.log(`[MCP Server] LexAI Pipeline MCP Server running on SSE: http://${host}:${port}`);
            console.log(`[MCP Server] GET /sse to connect, POST /message?sessionId=<id> to send messages`);
        });
    }
    else {
        // Default to stdio
        const transport = new stdio_js_1.StdioServerTransport();
        await server.connect(transport);
        console.error('[MCP Server] LexAI Pipeline MCP Server running on stdio');
    }
}
startServer().catch((err) => {
    console.error('[MCP Server] Critical error running MCP Server:', err);
    process.exit(1);
});
