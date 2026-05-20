#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ImageGenerator } from "./generator.js";
import { registerTools } from "./tools.js";

async function main() {
  // Load and validate configuration
  const config = loadConfig();

  // Create generator and validate API key
  const generator = new ImageGenerator(config);
  try {
    await generator.validateApiKey();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`API key validation failed:\n${message}`);
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: "mcp-asset-generator",
    version: "1.0.0",
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
