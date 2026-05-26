export interface ServerConfig {
  openaiApiKey: string;
  imageModel: string;
  outputBaseDir: string;
}

export function loadConfig(): ServerConfig {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    outputBaseDir: process.env.ASSET_OUTPUT_DIR || "assets",
  };
}
