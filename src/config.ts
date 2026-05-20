export interface ServerConfig {
  openaiApiKey: string;
  imageModel: string;
  outputBaseDir: string;
}

export function loadConfig(): ServerConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.error(
      "ERROR: OPENAI_API_KEY environment variable is not set.\n" +
        "Set it in your .env file or environment:\n" +
        "  export OPENAI_API_KEY=sk-...\n"
    );
    process.exit(1);
  }

  return {
    openaiApiKey,
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    outputBaseDir: process.env.ASSET_OUTPUT_DIR || "assets",
  };
}
