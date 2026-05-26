import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ImageGenerator } from "./generator.js";
import { inferAssetType } from "./prompt.js";
import type { AssetType, QualityTier } from "./types.js";
import { GenerationError } from "./errors.js";
import { saveSpriteSheetMeta, saveImage } from "./files.js";
import {
  buildNewsletterSvg,
  overlayTextOnImage,
} from "./text-overlay.js";
import {
  findIntegrationPoints,
  generateDiffPreview,
  applyWiringChanges,
  type WiringProposal,
} from "./wiring.js";
import {
  generateFrames,
  generateSingleSheet,
  generateHybridSheet,
  stitchFrames,
  cleanFramesForGif,
} from "./sprite-frames.js";
import { createAnimatedGif } from "./gif.js";

const ASSET_TYPE_ENUM = [
  "logo",
  "icon",
  "og_image",
  "banner",
  "favicon",
  "illustration",
  "newsletter_banner",
  "game_sprite",
  "game_icon",
  "game_character",
  "game_background",
  "game_ui",
  "print_newsletter",
  "sprite_sheet",
] as const;

// Common optional params shared by all generation tools
const commonOptionalParams = {
  width: z
    .number()
    .int()
    .min(256)
    .max(4096)
    .optional()
    .describe("Image width in pixels. Override the type default."),
  height: z
    .number()
    .int()
    .min(256)
    .max(4096)
    .optional()
    .describe("Image height in pixels. Override the type default."),
  quality: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Quality tier: low (draft/fast), medium (balanced), high (production)."
    ),
  background: z
    .enum(["transparent", "opaque"])
    .optional()
    .describe("Background type. Override the type default."),
};

function formatResult(result: {
  type: AssetType;
  filePath: string;
  width: number;
  height: number;
  model: string;
  quality: QualityTier;
  enhancedPrompt: string;
}): string {
  return [
    `Generated ${result.type} asset:`,
    `  File: ${result.filePath}`,
    `  Dimensions: ${result.width}x${result.height}`,
    `  Model: ${result.model}`,
    `  Quality: ${result.quality}`,
    ``,
    `Enhanced prompt used:`,
    `  ${result.enhancedPrompt}`,
  ].join("\n");
}

async function handleGenerate(
  generator: ImageGenerator,
  assetType: AssetType,
  args: {
    prompt: string;
    width?: number;
    height?: number;
    quality?: string;
    background?: string;
  },
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) {
  const sendProgress = async (
    step: string,
    progress: number,
    total: number
  ) => {
    const progressToken = extra._meta?.progressToken;
    if (progressToken !== undefined) {
      await extra.sendNotification({
        method: "notifications/progress" as const,
        params: { progressToken, progress, total, message: step },
      });
    }
  };

  try {
    const result = await generator.generate(
      {
        prompt: args.prompt,
        type: assetType,
        width: args.width,
        height: args.height,
        quality: args.quality as QualityTier | undefined,
        background: args.background as "transparent" | "opaque" | undefined,
      },
      (step, progress, total) => {
        sendProgress(step, progress, total);
      }
    );

    return {
      content: [{ type: "text" as const, text: formatResult(result) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof GenerationError ? error.code : "unknown";
    return {
      content: [
        {
          type: "text" as const,
          text: `Generation failed [${errorCode}]: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

interface SpecializedToolDef {
  name: string;
  type: AssetType;
  description: string;
  promptDescription: string;
}

const SPECIALIZED_TOOLS: SpecializedToolDef[] = [
  {
    name: "generate_logo",
    type: "logo",
    description:
      "Generate a logo with transparent background, flat/minimal style, and clean lines. " +
      "Default: 1024x1024, transparent PNG, high quality.",
    promptDescription:
      "Describe the logo (e.g., 'a mountain peak logo for an outdoor adventure brand')",
  },
  {
    name: "generate_icon",
    type: "icon",
    description:
      "Generate an app icon with a simple, recognizable symbol. " +
      "Default: 1024x1024, transparent PNG, high quality.",
    promptDescription:
      "Describe the icon (e.g., 'a camera icon for a photo editing app')",
  },
  {
    name: "generate_og_image",
    type: "og_image",
    description:
      "Generate an Open Graph / social media share image with bold headline composition. " +
      "Default: 1536x1024 landscape, opaque background, high quality.",
    promptDescription:
      "Describe the OG image (e.g., 'a professional SaaS product announcement with blue gradient')",
  },
  {
    name: "generate_banner",
    type: "banner",
    description:
      "Generate a hero banner or header image with wide cinematic composition. " +
      "Default: 1536x1024 landscape, opaque background, high quality.",
    promptDescription:
      "Describe the banner (e.g., 'a tech conference hero image with abstract circuit patterns')",
  },
  {
    name: "generate_favicon",
    type: "favicon",
    description:
      "Generate a favicon — extremely simple iconic symbol that works at tiny sizes. " +
      "Default: 1024x1024 (scale down for use), transparent PNG, medium quality.",
    promptDescription:
      "Describe the favicon (e.g., 'a lightning bolt favicon for an energy company')",
  },
  {
    name: "generate_illustration",
    type: "illustration",
    description:
      "Generate a UI illustration or graphic matching modern app aesthetics. " +
      "Default: 1024x1024, opaque background, high quality.",
    promptDescription:
      "Describe the illustration (e.g., 'an onboarding illustration showing a person setting up their profile')",
  },
  {
    name: "generate_newsletter_banner",
    type: "newsletter_banner",
    description:
      "Generate an email newsletter header image with email-safe composition. " +
      "Default: 1536x1024 landscape, opaque background, medium quality.",
    promptDescription:
      "Describe the newsletter banner (e.g., 'a monthly product update email header with rocket theme')",
  },
  {
    name: "generate_game_sprite",
    type: "game_sprite",
    description:
      "Generate a 2D game sprite — character, enemy, object, or prop with clean edges for game engines. " +
      "Default: 1024x1024, transparent PNG, high quality.",
    promptDescription:
      "Describe the sprite (e.g., 'a pixel-art knight character with sword and shield')",
  },
  {
    name: "generate_game_icon",
    type: "game_icon",
    description:
      "Generate a game item/ability icon — inventory items, power-ups, spells, loot. " +
      "Bold outlined style readable at small sizes. Default: 1024x1024, transparent PNG, high quality.",
    promptDescription:
      "Describe the game icon (e.g., 'a glowing health potion in a red glass bottle')",
  },
  {
    name: "generate_game_character",
    type: "game_character",
    description:
      "Generate full-body game character concept art — players, NPCs, enemies, bosses. " +
      "Default: 1024x1536 portrait, transparent PNG, high quality.",
    promptDescription:
      "Describe the character (e.g., 'a cyberpunk hacker with neon visor and long coat')",
  },
  {
    name: "generate_game_background",
    type: "game_background",
    description:
      "Generate a game environment/level background — scenes, landscapes, parallax layers. " +
      "Default: 1536x1024 landscape, opaque, high quality.",
    promptDescription:
      "Describe the scene (e.g., 'a dark forest level with glowing mushrooms and fog')",
  },
  {
    name: "generate_game_ui",
    type: "game_ui",
    description:
      "Generate a game UI element — buttons, frames, panels, health bars, menu components. " +
      "Default: 1024x1024, transparent PNG, high quality.",
    promptDescription:
      "Describe the UI element (e.g., 'an ornate golden frame for a fantasy game inventory slot')",
  },
];

// MCP tool annotations — all generation tools create files but don't modify existing ones
const GENERATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function registerTools(server: McpServer, generator: ImageGenerator) {
  // Register specialized tools (TOOL-01 through TOOL-07) with annotations
  for (const tool of SPECIALIZED_TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      {
        prompt: z.string().describe(tool.promptDescription),
        ...commonOptionalParams,
      },
      GENERATION_ANNOTATIONS,
      async (args, extra) => handleGenerate(generator, tool.type, args, extra)
    );
  }

  // Register general router tool (TOOL-08) with annotations
  server.tool(
    "generate_asset",
    "Generate any visual asset from a text description. Infers the best asset type " +
      "(logo, icon, banner, etc.) from your prompt and applies appropriate art direction. " +
      "Use this when you're not sure which specific tool to use.",
    {
      prompt: z
        .string()
        .describe(
          "Description of what you need (e.g., 'I need a newsletter header for my SaaS app')"
        ),
      type: z
        .enum(ASSET_TYPE_ENUM)
        .optional()
        .describe(
          "Force a specific asset type. If omitted, the best type is inferred from your prompt."
        ),
      ...commonOptionalParams,
    },
    GENERATION_ANNOTATIONS,
    async (args, extra) => {
      const assetType: AssetType = args.type ?? inferAssetType(args.prompt);
      return handleGenerate(generator, assetType, args, extra);
    }
  );

  // Print newsletter: generates background image (no text) then overlays crisp text via sharp
  server.tool(
    "generate_print_newsletter",
    "Generate a full-page printable newsletter. Creates a visual background layout via " +
      "image generation, then overlays crisp, readable text programmatically. " +
      "No garbled AI text. Print-ready at 8.5x11 proportions.",
    {
      visual_prompt: z
        .string()
        .describe(
          "Describe the visual design/background only (colors, brand style, imagery). " +
            "Text will be overlaid separately. Example: 'dark background with emerald green " +
            "accents, subtle geometric patterns, modern tech startup aesthetic'"
        ),
      headline: z
        .string()
        .describe("The main headline text (e.g., 'Your clients owe you money. Dun gets it back.')"),
      sections: z
        .array(
          z.object({
            heading: z.string().describe("Section heading"),
            body: z.string().describe("Section body text"),
          })
        )
        .describe("Newsletter content sections (heading + body pairs)"),
      footer: z
        .string()
        .optional()
        .describe("Footer text (e.g., website URL, contact info)"),
      accent_color: z
        .string()
        .optional()
        .describe("Accent color as hex (e.g., '#10b981'). Defaults to emerald green."),
      text_color: z
        .string()
        .optional()
        .describe("Body text color as hex. Defaults to '#e4e4e7' (light gray)."),
      logo_image: z
        .string()
        .optional()
        .describe(
          "Path to an existing logo or banner image to place at the top. " +
            "Scaled to fit page width. Text content flows below it."
        ),
      logo_prompt: z
        .string()
        .optional()
        .describe(
          "If no logo_image is provided, generate one from this description. " +
            "Example: 'a payment app logo with an envelope and checkmark, blue-green gradient'"
        ),
      quality: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Background image quality. Defaults to high."),
    },
    GENERATION_ANNOTATIONS,
    async (args, extra) => {
      const width = 1024;
      const height = 1536;

      const bgPrompt =
        args.visual_prompt +
        ", no text whatsoever, no words, no letters, no typography, " +
        "abstract visual background only, full page layout at 8.5x11 portrait proportions, " +
        "leave large open areas for text overlay";

      const sendProgress = async (step: string, progress: number, total: number) => {
        const progressToken = extra._meta?.progressToken;
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: "notifications/progress" as const,
            params: { progressToken, progress, total, message: step },
          });
        }
      };

      try {
        let logoBuffer: Buffer | null = null;
        let logoHeight = 0;
        const hasLogo = !!(args.logo_image || args.logo_prompt);
        const totalSteps = hasLogo ? 4 : 3;
        let stepNum = 1;

        // Get or generate logo
        if (args.logo_image) {
          const logoPath = path.resolve(args.logo_image);
          if (!fs.existsSync(logoPath)) {
            return {
              content: [
                { type: "text" as const, text: `Logo image not found: ${args.logo_image}` },
              ],
              isError: true,
            };
          }
          await sendProgress("Processing logo image", stepNum++, totalSteps);
          const logoSharp = sharp(fs.readFileSync(logoPath));
          const logoMeta = await logoSharp.metadata();

          const logoMaxWidth = width - 72 * 2;
          const scale = Math.min(1, logoMaxWidth / (logoMeta.width || logoMaxWidth));
          const scaledW = Math.round((logoMeta.width || logoMaxWidth) * scale);
          const scaledH = Math.round((logoMeta.height || 200) * scale);
          logoHeight = scaledH;

          logoBuffer = await logoSharp
            .resize(scaledW, scaledH, { fit: "inside" })
            .png()
            .toBuffer();
        } else if (args.logo_prompt) {
          await sendProgress("Generating logo", stepNum++, totalSteps);
          const logoResult = await generator.generate({
            prompt: args.logo_prompt,
            type: "logo",
            quality: "high",
          });
          const rawLogo = sharp(fs.readFileSync(logoResult.filePath));
          const logoMeta = await rawLogo.metadata();

          // Scale generated logo to a banner-like size for the newsletter header
          const logoMaxWidth = width - 72 * 2;
          const targetH = 200;
          const scale = Math.min(
            logoMaxWidth / (logoMeta.width || logoMaxWidth),
            targetH / (logoMeta.height || targetH)
          );
          const scaledW = Math.round((logoMeta.width || logoMaxWidth) * scale);
          const scaledH = Math.round((logoMeta.height || targetH) * scale);
          logoHeight = scaledH;

          logoBuffer = await rawLogo
            .resize(scaledW, scaledH, { fit: "inside" })
            .png()
            .toBuffer();
        }

        // Generate background
        await sendProgress("Generating visual background", stepNum++, totalSteps);

        const bgResult = await generator.generate(
          {
            prompt: bgPrompt,
            type: "print_newsletter",
            quality: (args.quality as "low" | "medium" | "high") ?? "high",
          },
          (step, p, t) => { sendProgress(step, p, t); }
        );

        // Build text overlay (offset below logo if present)
        await sendProgress("Overlaying text content", stepNum++, totalSteps);
        const bgBuffer = fs.readFileSync(bgResult.filePath);

        const svgText = buildNewsletterSvg(width, height, {
          headline: args.headline,
          sections: args.sections,
          footer: args.footer,
          accentColor: args.accent_color,
          textColor: args.text_color,
          logoTopOffset: logoHeight > 0 ? logoHeight : undefined,
        });

        // Step 4: Composite everything
        const composites: sharp.OverlayOptions[] = [];

        // Dark scrim
        const scrimSvg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
            `<rect width="${width}" height="${height}" fill="black" opacity="0.55" />` +
            `</svg>`
        );
        composites.push({ input: scrimSvg, top: 0, left: 0 });

        // Logo at top center
        if (logoBuffer) {
          const logoMeta = await sharp(logoBuffer).metadata();
          const logoX = Math.round((width - (logoMeta.width || 0)) / 2);
          composites.push({ input: logoBuffer, top: 30, left: logoX });
        }

        // Text overlay
        composites.push({ input: Buffer.from(svgText), top: 0, left: 0 });

        const finalBuffer = await sharp(bgBuffer)
          .resize(width, height, { fit: "cover" })
          .composite(composites)
          .png()
          .toBuffer();

        // Save the composited version
        await sendProgress("Saving final newsletter", stepNum++, totalSteps);
        fs.writeFileSync(bgResult.filePath, finalBuffer);

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Generated print newsletter:\n` +
                `  File: ${bgResult.filePath}\n` +
                `  Dimensions: ${width}x${height}\n` +
                `  Logo: ${args.logo_image ? "yes (user image)" : args.logo_prompt ? "yes (generated)" : "none"}\n` +
                `  Sections: ${args.sections.length}\n` +
                `Background prompt used:\n  ${bgResult.enhancedPrompt}`,
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const errorCode = error instanceof GenerationError ? error.code : "unknown";
        return {
          content: [
            { type: "text" as const, text: `Newsletter generation failed [${errorCode}]: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Sprite sheet tool with extra parameters and JSON metadata output
  server.tool(
    "generate_sprite_sheet",
    "Generate a sprite sheet with animation frames in a grid layout, plus a companion " +
      "JSON metadata file (TexturePacker/Phaser compatible). Produces a single PNG with " +
      "multiple frames of the same character or object showing different animation poses.",
    {
      prompt: z
        .string()
        .describe(
          "Describe the character and animation (e.g., 'a pixel-art knight walk cycle, 8 frames')"
        ),
      animation: z
        .string()
        .optional()
        .describe(
          "Animation name for the metadata file (e.g., 'walk', 'idle', 'attack'). Defaults to 'idle'."
        ),
      frames: z
        .number()
        .int()
        .min(2)
        .max(16)
        .optional()
        .describe("Number of animation frames (2-16). Defaults to 8."),
      columns: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("Grid columns. Defaults to 4."),
      fps: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe("Playback speed in frames per second. Defaults to 12."),
      ...commonOptionalParams,
    },
    GENERATION_ANNOTATIONS,
    async (args, extra) => {
      const frameCount = args.frames ?? 8;
      const columns = args.columns ?? 4;
      const rows = Math.ceil(frameCount / columns);
      const animName = args.animation ?? "idle";
      const fps = args.fps ?? 12;

      // Enhance prompt with sprite sheet specifics
      const gridPrompt =
        `${args.prompt}, arranged as a ${columns}x${rows} grid sprite sheet ` +
        `with ${frameCount} sequential animation frames, each frame shows a ` +
        `different phase of the ${animName} animation, uniform frame spacing`;

      const result = await handleGenerate(
        generator,
        "sprite_sheet",
        { ...args, prompt: gridPrompt },
        extra
      );

      // If generation succeeded, also create JSON metadata
      if (!result.isError) {
        const text = result.content[0];
        if (text.type === "text") {
          const fileMatch = text.text.match(/File:\s*(.+)/);
          if (fileMatch) {
            const imagePath = fileMatch[1].trim();
            // Calculate frame dimensions from the actual image size
            const sizeMatch = text.text.match(/Dimensions:\s*(\d+)x(\d+)/);
            const imgW = sizeMatch ? parseInt(sizeMatch[1]) : 1024;
            const imgH = sizeMatch ? parseInt(sizeMatch[2]) : 1024;
            const frameWidth = Math.floor(imgW / columns);
            const frameHeight = Math.floor(imgH / rows);

            const jsonPath = saveSpriteSheetMeta(imagePath, {
              animation: animName,
              frameWidth,
              frameHeight,
              columns,
              rows,
              frameCount,
              fps,
            });

            text.text +=
              `\n\nSprite sheet metadata:\n` +
              `  JSON: ${jsonPath}\n` +
              `  Frames: ${frameCount} (${columns}x${rows} grid)\n` +
              `  Frame size: ${frameWidth}x${frameHeight}px\n` +
              `  Animation: "${animName}" at ${fps} FPS`;
          }
        }
      }

      return result;
    }
  );

  // Per-frame sprite sheet: generates each frame individually for higher quality
  server.tool(
    "generate_sprite_sheet_hq",
    "Generate a high-quality sprite sheet with consistent character design across all frames. " +
      "Uses a hybrid pipeline: generates a seed frame, then uses the edit API to create an " +
      "animation strip anchored to the seed for character consistency. Frames are extracted " +
      "by contour detection (not grid splitting) for clean isolation. Includes animated GIF " +
      "preview and JSON metadata.",
    {
      prompt: z
        .string()
        .describe(
          "Detailed character/object description. Be specific about colors, features, and " +
            "distinguishing details for best consistency across frames. " +
            "Example: 'a pixel-art goblin warrior with green skin, brown leather armor, and a wooden club'"
        ),
      animation: z
        .string()
        .optional()
        .describe(
          "Animation type. Built-in presets: 'idle', 'walk', 'run', 'attack', 'jump'. " +
            "Or any custom name -- provide frame_descriptions for custom animations. " +
            "Defaults to 'idle'."
        ),
      frame_descriptions: z
        .array(z.string())
        .optional()
        .describe(
          "Override auto-generated per-frame poses. Each string describes the pose for " +
            "that frame. Must have at least as many entries as the frame count."
        ),
      frames: z
        .number()
        .int()
        .min(2)
        .max(16)
        .optional()
        .describe("Number of animation frames (2-16). Defaults to 8."),
      columns: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("Grid columns in the output sprite sheet. Defaults to 4."),
      fps: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe("Playback speed in frames per second for metadata. Defaults to 12."),
      quality: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Quality tier. Defaults to high."),
      background: z
        .enum(["transparent", "opaque"])
        .optional()
        .describe("Background type for frames. Defaults to transparent."),
      gif: z
        .boolean()
        .optional()
        .describe("Also generate an animated GIF preview. Defaults to true."),
      gif_background: z
        .string()
        .optional()
        .describe("Background color for the GIF as hex (e.g., '#2a2a2a'). Defaults to dark gray. Use 'transparent' for no background."),
      per_frame_mode: z
        .boolean()
        .optional()
        .describe(
          "Generation mode override. Default (unset): hybrid pipeline -- generates a seed " +
            "frame then uses the edit API to create an animation strip with contour-based " +
            "extraction. Set to true for legacy per-frame edit mode. Set to false for " +
            "single-sheet mode (fastest but may have frame bleed)."
        ),
    },
    GENERATION_ANNOTATIONS,
    async (args, extra) => {
      const frameCount = args.frames ?? 8;
      const columns = args.columns ?? 4;
      const rows = Math.ceil(frameCount / columns);
      const animName = args.animation ?? "idle";
      const fps = args.fps ?? 12;
      const usePerFrame = args.per_frame_mode === true;
      const useSingleSheet = args.per_frame_mode === false;
      // Default: hybrid pipeline (seed + edit strip + contour extraction)

      const wantGif = args.gif !== false;

      const sendProgress = async (step: string, progress: number, total: number) => {
        const progressToken = extra._meta?.progressToken;
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: "notifications/progress" as const,
            params: { progressToken, progress, total, message: step },
          });
        }
      };

      try {
        let frameBuffers: Buffer[];
        let frameWidth: number;
        let frameHeight: number;
        let apiCalls: number;
        let mode: string;
        let qualityMetrics: import("./sprite-frames.js").SpriteQualityMetrics | undefined;

        if (usePerFrame) {
          mode = "per-frame edit";
          apiCalls = frameCount;
          const result = await generateFrames(
            generator,
            {
              prompt: args.prompt,
              animation: animName,
              frameCount,
              columns,
              frameDescriptions: args.frame_descriptions,
              quality: args.quality as QualityTier | undefined,
              background: args.background as "transparent" | "opaque" | undefined,
            },
            (step, progress, _total) => {
              sendProgress(step, progress, frameCount + 3);
            }
          );
          frameBuffers = result;
          frameWidth = 1024;
          frameHeight = 1024;
        } else if (useSingleSheet) {
          mode = "single-sheet";
          apiCalls = 1;
          const result = await generateSingleSheet(
            generator,
            {
              prompt: args.prompt,
              animation: animName,
              frameCount,
              columns,
              frameDescriptions: args.frame_descriptions,
              quality: args.quality as QualityTier | undefined,
              background: args.background as "transparent" | "opaque" | undefined,
            },
            (step, progress, _total) => {
              sendProgress(step, progress, 6);
            }
          );
          frameBuffers = result.frames;
          frameWidth = result.frameWidth;
          frameHeight = result.frameHeight;
          qualityMetrics = result.quality;
        } else {
          // Default: hybrid pipeline
          mode = "hybrid";
          apiCalls = 1; // single generate call + contour extraction
          const result = await generateHybridSheet(
            generator,
            {
              prompt: args.prompt,
              animation: animName,
              frameCount,
              columns,
              frameDescriptions: args.frame_descriptions,
              quality: args.quality as QualityTier | undefined,
              background: args.background as "transparent" | "opaque" | undefined,
            },
            (step, progress, total) => {
              sendProgress(step, progress, total);
            }
          );
          frameBuffers = result.frames;
          frameWidth = result.frameWidth;
          frameHeight = result.frameHeight;
          qualityMetrics = result.quality;
        }

        // Stitch frames into clean grid
        await sendProgress("Stitching frames into sprite sheet", 1, 3);
        const sheetBuffer = await stitchFrames(frameBuffers, columns, frameWidth, frameHeight);

        // Save
        await sendProgress("Saving sprite sheet and metadata", 2, 3);
        const outputDir = process.env.ASSET_OUTPUT_DIR || "assets";
        const filePath = saveImage(sheetBuffer, "sprite_sheet", args.prompt, outputDir);

        const jsonPath = saveSpriteSheetMeta(filePath, {
          animation: animName,
          frameWidth,
          frameHeight,
          columns,
          rows,
          frameCount,
          fps,
        });

        const sheetWidth = columns * frameWidth;
        const sheetHeight = rows * frameHeight;

        // Generate animated GIF preview (with binary alpha cleanup for GIF)
        let gifPath: string | null = null;
        if (wantGif) {
          await sendProgress("Creating animated GIF preview", 3, 3);

          let gifBg: { r: number; g: number; b: number } | null | undefined;
          if (args.gif_background === "transparent") {
            gifBg = null;
          } else if (args.gif_background) {
            const hex = args.gif_background.replace("#", "");
            gifBg = {
              r: parseInt(hex.slice(0, 2), 16),
              g: parseInt(hex.slice(2, 4), 16),
              b: parseInt(hex.slice(4, 6), 16),
            };
          }

          // Apply binary alpha cleanup for GIF (GIF only supports on/off transparency)
          const gifFrames = await cleanFramesForGif(frameBuffers);

          const gifBuffer = await createAnimatedGif(gifFrames, frameWidth, frameHeight, fps, {
            background: gifBg,
          });
          gifPath = filePath.replace(/\.png$/, ".gif");
          fs.writeFileSync(gifPath, gifBuffer);
        }

        const output = [
          `Generated sprite sheet (${mode} mode):`,
          `  File: ${filePath}`,
          `  Dimensions: ${sheetWidth}x${sheetHeight}`,
          `  Frames: ${frameCount} (${columns}x${rows} grid)`,
          `  Frame size: ${frameWidth}x${frameHeight}px`,
          `  Animation: "${animName}" at ${fps} FPS`,
          `  JSON metadata: ${jsonPath}`,
        ];
        if (gifPath) {
          output.push(`  GIF preview: ${gifPath}`);
        }
        output.push(
          `  API calls: ${apiCalls}`,
          ``,
          mode === "hybrid"
            ? `All frames generated in a single image for maximum consistency.\nFrames extracted by contour detection and normalized with bottom-center anchoring.`
            : mode === "single-sheet"
            ? `All frames generated in a single image, then split and post-processed.`
            : `Each frame generated individually via edit API.`,
        );

        // Append quality gate warnings if any
        if (qualityMetrics && qualityMetrics.warnings.length > 0) {
          output.push(``, `Quality warnings:`);
          for (const w of qualityMetrics.warnings) {
            output.push(`  - ${w}`);
          }
        }

        return {
          content: [
            { type: "text" as const, text: output.join("\n") },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const errorCode = error instanceof GenerationError ? error.code : "unknown";
        return {
          content: [
            {
              type: "text" as const,
              text: `Per-frame sprite sheet generation failed [${errorCode}]: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // GIF creation from folder of images (timelapse, screenshots, etc.)
  server.tool(
    "create_gif",
    "Create an animated GIF from a folder of images (PNG, JPG, WebP). " +
      "Images are sorted alphabetically and played in sequence. " +
      "Useful for timelapses, screenshot sequences, progress recordings, or any image series.",
    {
      folder: z
        .string()
        .describe("Path to folder containing images. Files are sorted alphabetically."),
      output: z
        .string()
        .optional()
        .describe("Output GIF path. Defaults to {folder}/animation.gif"),
      fps: z
        .number()
        .min(1)
        .max(30)
        .optional()
        .describe("Frames per second. Defaults to 2 (good for timelapse/screenshots)."),
      width: z
        .number()
        .int()
        .min(64)
        .max(1920)
        .optional()
        .describe("Output width in pixels. Defaults to 800. Height scales to preserve aspect ratio."),
      loop: z
        .boolean()
        .optional()
        .describe("Loop the animation. Defaults to false (play once and stop)."),
      background: z
        .string()
        .optional()
        .describe("Background color as hex (e.g., '#ffffff'). Defaults to white."),
    },
    { readOnlyHint: false, destructiveHint: false },
    async (args, extra) => {
      const folder = path.resolve(args.folder);

      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        return {
          content: [{ type: "text" as const, text: `Folder not found: ${args.folder}` }],
          isError: true,
        };
      }

      // Collect image files, sorted alphabetically
      const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
      const files = fs.readdirSync(folder)
        .filter((f: string) => imageExts.has(path.extname(f).toLowerCase()))
        .sort();

      if (files.length < 2) {
        return {
          content: [{ type: "text" as const, text: `Need at least 2 images. Found ${files.length} in ${args.folder}` }],
          isError: true,
        };
      }

      const progressToken = extra._meta?.progressToken;
      const sendProgress = async (step: string, progress: number, total: number) => {
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: "notifications/progress" as const,
            params: { progressToken, progress, total, message: step },
          });
        }
      };

      // Read all images into buffers
      const totalSteps = files.length + 1;
      const frameBuffers: Buffer[] = [];
      for (let i = 0; i < files.length; i++) {
        await sendProgress(`Reading ${files[i]}`, i + 1, totalSteps);
        frameBuffers.push(fs.readFileSync(path.join(folder, files[i])));
      }

      // Detect dimensions from first image
      const firstMeta = await sharp(frameBuffers[0]).metadata();
      const outW = args.width ?? 800;
      const outH = Math.round(outW * ((firstMeta.height ?? 600) / (firstMeta.width ?? 800)));

      // Parse background color
      let bg: { r: number; g: number; b: number } | null = { r: 255, g: 255, b: 255 };
      if (args.background === "transparent") {
        bg = null;
      } else if (args.background) {
        const hex = args.background.replace("#", "");
        bg = {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }

      await sendProgress("Encoding GIF", files.length + 1, totalSteps);
      const gifBuffer = await createAnimatedGif(
        frameBuffers,
        firstMeta.width ?? 800,
        firstMeta.height ?? 600,
        args.fps ?? 2,
        {
          width: outW,
          height: outH,
          background: bg,
          loop: args.loop === true ? 0 : -1, // default: play once
          stripBackground: false, // don't strip bg on screenshots
        }
      );

      const outputPath = args.output ?? path.join(folder, "animation.gif");
      fs.writeFileSync(outputPath, gifBuffer);

      return {
        content: [{
          type: "text" as const,
          text: [
            `Created animated GIF:`,
            `  File: ${outputPath}`,
            `  Frames: ${files.length}`,
            `  Size: ${outW}x${outH}`,
            `  FPS: ${args.fps ?? 2}`,
            `  Loop: ${args.loop === true ? "infinite" : "play once"}`,
            `  File size: ${(gifBuffer.length / 1024).toFixed(0)} KB`,
          ].join("\n"),
        }],
      };
    }
  );

  // Wiring tools (WIRE-01 through WIRE-04)
  server.tool(
    "find_asset_references",
    "Search the codebase for places where a generated asset should be wired in. " +
      "Finds img src attributes, favicon links, CSS background-image rules, component imports, " +
      "and og:image meta tags. Returns a diff preview of proposed changes.",
    {
      asset_path: z
        .string()
        .describe(
          "Path to the generated asset file (e.g., 'assets/logos/my-logo.png')"
        ),
      asset_type: z
        .enum(ASSET_TYPE_ENUM)
        .optional()
        .describe(
          "Filter to only show references relevant to this asset type"
        ),
      search_dir: z
        .string()
        .optional()
        .describe(
          "Directory to search (defaults to current working directory)"
        ),
    },
    { readOnlyHint: true, destructiveHint: false },
    async (args) => {
      const searchDir = args.search_dir || process.cwd();
      const assetPath = path.resolve(args.asset_path);

      if (!fs.existsSync(assetPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Asset file not found: ${args.asset_path}`,
            },
          ],
          isError: true,
        };
      }

      const points = findIntegrationPoints(searchDir, args.asset_type);

      if (points.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "No integration points found in the codebase.\n\n" +
                "This could mean:\n" +
                "- The codebase doesn't reference assets matching this type yet\n" +
                "- Source files are in a non-standard location\n" +
                "- You may need to manually add the asset reference",
            },
          ],
        };
      }

      const proposals = generateDiffPreview(points, assetPath, searchDir);

      const summary = [
        `Found ${points.length} integration point(s) in the codebase:`,
        "",
      ];

      for (const point of points) {
        summary.push(
          `  ${point.file}:${point.line} [${point.type}]`,
          `    Current: ${point.currentValue}`,
          `    Line: ${point.lineContent}`,
          ""
        );
      }

      if (proposals.length > 0) {
        summary.push("", "Proposed changes:", "");
        for (const p of proposals) {
          summary.push(
            `--- ${p.file}:${p.line} [${p.type}]`,
            `- ${p.before}`,
            `+ ${p.after}`,
            ""
          );
        }
        summary.push(
          `Use apply_asset_wiring to apply these ${proposals.length} change(s).`
        );
      }

      // Store proposals for apply step
      const proposalData = JSON.stringify(proposals);

      return {
        content: [
          { type: "text" as const, text: summary.join("\n") },
          {
            type: "text" as const,
            text: `\n<!-- WIRING_PROPOSALS:${Buffer.from(proposalData).toString("base64")} -->`,
          },
        ],
      };
    }
  );

  server.tool(
    "apply_asset_wiring",
    "Apply previously previewed wiring changes to the codebase. " +
      "IMPORTANT: You must call find_asset_references first to generate the diff preview. " +
      "This tool modifies source files — only call it after the user confirms the changes.",
    {
      asset_path: z
        .string()
        .describe("Path to the generated asset file"),
      asset_type: z
        .enum(ASSET_TYPE_ENUM)
        .optional()
        .describe("Filter to references relevant to this asset type"),
      search_dir: z
        .string()
        .optional()
        .describe("Directory to search (defaults to current working directory)"),
      confirmed: z
        .boolean()
        .describe(
          "Must be true to apply changes. Set to false to see what would change without modifying files."
        ),
    },
    { readOnlyHint: false, destructiveHint: true },
    async (args) => {
      const searchDir = args.search_dir || process.cwd();
      const assetPath = path.resolve(args.asset_path);

      if (!fs.existsSync(assetPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Asset file not found: ${args.asset_path}`,
            },
          ],
          isError: true,
        };
      }

      const points = findIntegrationPoints(searchDir, args.asset_type);
      const proposals = generateDiffPreview(points, assetPath, searchDir);

      if (proposals.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No applicable changes found.",
            },
          ],
        };
      }

      if (!args.confirmed) {
        const preview = proposals
          .map(
            (p) =>
              `${p.file}:${p.line}\n  - ${p.before}\n  + ${p.after}`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Dry run — ${proposals.length} change(s) would be applied:\n\n${preview}\n\n` +
                `Call again with confirmed=true to apply these changes.`,
            },
          ],
        };
      }

      const result = applyWiringChanges(proposals, searchDir);

      const output = [`Applied ${result.applied} change(s) to the codebase.`];
      if (result.errors.length > 0) {
        output.push("", "Errors:", ...result.errors.map((e) => `  ${e}`));
      }

      return {
        content: [{ type: "text" as const, text: output.join("\n") }],
      };
    }
  );
}
