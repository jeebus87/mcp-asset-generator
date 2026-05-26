#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ImageGenerator } from "./generator.js";
import { registerTools } from "./tools.js";

async function main() {
  // Load .env file (if present) before reading config
  dotenvConfig();

  // Load configuration (API key may arrive later via .env)
  const config = loadConfig();

  // Create generator (connects to OpenAI lazily on first tool call)
  const generator = new ImageGenerator(config);

  // Create MCP server
  const server = new McpServer({
    name: "mcp-asset-generator",
    version: "0.1.0",
  });

  // Register tools
  registerTools(server, generator);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("mcp-asset-generator server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
