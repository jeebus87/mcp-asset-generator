import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults imageModel to gpt-image-2", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.OPENAI_IMAGE_MODEL;

    // Dynamic import to pick up env changes
    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.imageModel).toBe("gpt-image-1");
  });

  it("respects OPENAI_IMAGE_MODEL override", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENAI_IMAGE_MODEL = "dall-e-3";

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.imageModel).toBe("dall-e-3");
  });

  it("defaults outputBaseDir to assets", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.ASSET_OUTPUT_DIR;

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.outputBaseDir).toBe("assets");
  });

  it("respects ASSET_OUTPUT_DIR override", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.ASSET_OUTPUT_DIR = "/tmp/custom-assets";

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.outputBaseDir).toBe("/tmp/custom-assets");
  });
});
