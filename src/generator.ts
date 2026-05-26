import { fileURLToPath } from "url";
import path from "path";
import { config as dotenvConfig } from "dotenv";
import OpenAI from "openai";
import type { ImageGenerateParams } from "openai/resources/images.js";
import { ServerConfig } from "./config.js";
import {
  AssetType,
  QualityTier,
  GenerationParams,
  GenerationResult,
  ASSET_TYPE_CONFIGS,
} from "./types.js";
import { enhancePrompt } from "./prompt.js";
import { saveImage } from "./files.js";
import { classifyApiError } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "..", ".env");

type ApiSize = NonNullable<ImageGenerateParams["size"]>;

// gpt-image-2 supported sizes
const API_SIZES: [ApiSize, number, number][] = [
  ["1024x1024", 1024, 1024],
  ["1536x1024", 1536, 1024],
  ["1024x1536", 1024, 1536],
];

function pickClosestSize(width: number, height: number): ApiSize {
  let best: ApiSize = "1024x1024";
  let bestDist = Infinity;

  for (const [size, w, h] of API_SIZES) {
    const dist = Math.abs(width - w) + Math.abs(height - h);
    if (dist < bestDist) {
      bestDist = dist;
      best = size;
    }
  }

  return best;
}

export class ImageGenerator {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /** Re-read .env and return a live OpenAI client. Throws if no key is set. */
  private getClient(): OpenAI {
    dotenvConfig({ path: ENV_PATH, override: true });
    const apiKey = process.env.OPENAI_API_KEY || this.config.openaiApiKey;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. " +
          `Add it to ${ENV_PATH} or set it in your environment.`
      );
    }
    this.config.openaiApiKey = apiKey;
    return new OpenAI({ apiKey });
  }

  async generate(
    params: GenerationParams,
    onProgress?: (step: string, progress: number, total: number) => void
  ): Promise<GenerationResult> {
    const typeConfig = ASSET_TYPE_CONFIGS[params.type];

    const width = params.width ?? typeConfig.defaultWidth;
    const height = params.height ?? typeConfig.defaultHeight;
    const quality = params.quality ?? typeConfig.defaultQuality;
    const background = params.background ?? typeConfig.defaultBackground;
    const outputDir = params.outputDir ?? this.config.outputBaseDir;

    // Step 1: Enhance prompt
    onProgress?.("Enhancing prompt with art direction", 1, 4);
    const enhanced = enhancePrompt(params.prompt, params.type, {
      background,
      width,
      height,
    });

    // Step 2: Call OpenAI API
    onProgress?.("Generating image via OpenAI", 2, 4);
    const size = pickClosestSize(width, height);

    // gpt-image-1 supports native transparent backgrounds.
    // gpt-image-2 does not. Use gpt-image-1 when transparency is needed.
    const needsTransparency = background === "transparent";
    const model = needsTransparency ? "gpt-image-1" : this.config.imageModel;

    const apiParams: ImageGenerateParams = {
      model,
      prompt: enhanced,
      n: 1,
      size,
      quality,
      ...(needsTransparency ? { background: "transparent" as const } : {}),
    };

    let response;
    try {
      response = await this.getClient().images.generate(apiParams);
    } catch (error) {
      throw classifyApiError(error, params.prompt);
    }

    // Step 3: Decode response
    onProgress?.("Decoding image data", 3, 4);
    if (!response.data || response.data.length === 0) {
      throw new Error("No image data received from API.");
    }
    const imageData = response.data[0];
    const b64 = imageData.b64_json;
    if (!b64) {
      throw new Error(
        "No b64_json in API response. Ensure the model supports base64 output."
      );
    }
    const buffer = Buffer.from(b64, "base64");

    // Parse actual dimensions from the size used
    const [actualWidth, actualHeight] = size === "auto"
      ? [width, height]
      : size.split("x").map(Number);

    // Step 4: Save file
    onProgress?.("Saving image file", 4, 4);
    const filePath = saveImage(buffer, params.type, params.prompt, outputDir);

    return {
      filePath,
      width: actualWidth,
      height: actualHeight,
      model: this.config.imageModel,
      quality,
      enhancedPrompt: enhanced,
      originalPrompt: params.prompt,
      type: params.type,
      generationParams: {
        size,
        quality,
        background,
        model: this.config.imageModel,
      },
    };
  }

  /**
   * Edit an existing image to produce a variation with a new prompt.
   * Used by per-frame sprite generation: generate frame 1, then edit it
   * for subsequent frames to maintain character consistency.
   */
  async editImage(
    sourceBuffer: Buffer,
    prompt: string,
    options?: {
      quality?: QualityTier;
      size?: "1024x1024" | "1536x1024" | "1024x1536";
      mask?: Buffer;
      background?: "transparent" | "opaque";
      inputFidelity?: "low" | "high";
      model?: string;
    }
  ): Promise<Buffer> {
    const imageFile = new File([new Uint8Array(sourceBuffer)], "source.png", { type: "image/png" });

    const editParams: Record<string, unknown> = {
      model: options?.model ?? "gpt-image-1",
      image: imageFile,
      prompt,
      n: 1,
      size: options?.size ?? "1024x1024",
      background: options?.background ?? "transparent",
    };

    if (options?.inputFidelity) {
      editParams.input_fidelity = options.inputFidelity;
    }

    if (options?.mask) {
      editParams.mask = new File([new Uint8Array(options.mask)], "mask.png", { type: "image/png" });
    }

    let response;
    try {
      response = await this.getClient().images.edit(editParams as any);
    } catch (error) {
      throw classifyApiError(error, prompt);
    }

    if (!response.data || response.data.length === 0) {
      throw new Error("No image data received from edit API.");
    }
    const b64 = response.data[0].b64_json;
    if (!b64) {
      throw new Error("No b64_json in edit API response.");
    }
    return Buffer.from(b64, "base64");
  }

  async validateApiKey(): Promise<void> {
    try {
      await this.getClient().models.list();
    } catch (error: unknown) {
      if (error instanceof OpenAI.APIError) {
        if (error.status === 403) {
          throw new Error(
            "OpenAI API key has insufficient permissions (403 Forbidden).\n" +
              "This usually means your organization requires verification.\n" +
              "Fix: Visit https://platform.openai.com/settings/organization/billing to verify your organization,\n" +
              "or check that your API key has the required permissions for image generation."
          );
        }
        if (error.status === 401) {
          throw new Error(
            "Invalid OpenAI API key (401 Unauthorized).\n" +
              "Check that your OPENAI_API_KEY is correct and not expired.\n" +
              "Get a new key at: https://platform.openai.com/api-keys"
          );
        }
        throw new Error(`OpenAI API error: ${error.message}`);
      }
      throw error;
    }
  }
}
