import sharp from "sharp";
import { ImageGenerator } from "./generator.js";
import type { QualityTier } from "./types.js";

/**
 * Per-frame pose descriptions for common animation types.
 * Each entry describes how the character should look in that frame.
 */
const ANIMATION_PRESETS: Record<string, string[]> = {
  idle: [
    "standing still, neutral pose, arms relaxed at sides",
    "standing still, very slight lean forward",
    "standing still, subtle breathing motion, chest slightly expanded",
    "standing still, very slight lean backward",
    "standing still, neutral pose, arms relaxed at sides",
    "standing still, subtle weight shift to left foot",
    "standing still, subtle breathing motion, chest slightly contracted",
    "standing still, subtle weight shift to right foot",
  ],
  walk: [
    "walking right, right leg forward foot flat on ground, left leg behind heel up, left arm forward right arm back, contact pose",
    "walking right, right foot bearing weight, left foot lifted behind, body slightly lower, recoil pose",
    "walking right, right leg straight under body, left knee raised swinging forward, passing pose",
    "walking right, left leg reaching forward, right leg pushing off behind, reaching pose",
    "walking right, left leg forward foot flat on ground, right leg behind heel up, mirror contact pose",
    "walking right, left foot bearing weight, right foot lifted behind, body slightly lower, mirror recoil pose",
    "walking right, left leg straight under body, right knee raised swinging forward, mirror passing pose",
    "walking right, right leg reaching forward, left leg pushing off behind, mirror reaching pose",
  ],
  run: [
    "running right, right foot striking ground, left arm forward, dynamic contact",
    "running right, airborne, right leg behind, left leg tucked, flight phase",
    "running right, left foot striking ground, right arm forward, mirror contact",
    "running right, airborne, left leg behind, right leg tucked, mirror flight",
    "running right, right foot forward, arms pumping, push-off",
    "running right, both feet off ground, leaning forward, full flight",
    "running right, left foot forward, arms pumping opposite, mirror push-off",
    "running right, maximum stride extension, full flight mirror",
  ],
  attack: [
    "attack windup, weapon raised behind, weight on back foot",
    "attack windup, weapon at highest point, body coiled",
    "attacking, weapon swinging forward, body rotating",
    "attacking, weapon at mid-swing, maximum speed pose",
    "attack impact, weapon extended forward, body fully rotated",
    "attack follow-through, weapon past target, momentum carrying",
    "attack recovery, pulling weapon back, recentering weight",
    "returning to ready stance, weapon at guard position",
  ],
  jump: [
    "preparing to jump, knees bending, crouching down",
    "launching upward, legs extending, arms rising",
    "ascending, body fully extended, arms up",
    "peak of jump, floating, legs slightly tucked",
    "beginning descent, body tilting slightly forward",
    "falling, legs extending downward, arms out for balance",
    "landing impact, knees bent, absorbing force",
    "recovery from landing, standing back up",
  ],
};

export interface SpriteSheetParams {
  prompt: string;
  animation: string;
  frameCount: number;
  columns: number;
  frameDescriptions?: string[];
  quality?: QualityTier;
  background?: "transparent" | "opaque";
  outputDir?: string;
  /** When true, use per-frame edit API instead of single-sheet generation.
   *  Single-sheet (default) generates all frames in one API call for maximum
   *  character consistency. Per-frame mode uses the edit API for more distinct
   *  poses but less consistency. */
  perFrameMode?: boolean;
  /** Only used in per-frame mode. Percentage of image to preserve from top (1-99). */
  maskPreserve?: number;
}

// ---------------------------------------------------------------------------
// Single-sheet generation (default, best consistency)
// ---------------------------------------------------------------------------

/**
 * Build the prompt for single-sheet sprite generation.
 * All frames are generated in one API call so the model maintains character
 * consistency across the entire sheet.
 */
export function buildSheetPrompt(
  baseDescription: string,
  animation: string,
  frameCount: number,
  columns: number,
  customDescriptions?: string[]
): string {
  const rows = Math.ceil(frameCount / columns);
  const poses = resolveFramePoses(animation, frameCount, customDescriptions);

  // Build per-frame descriptions for the grid
  const frameList = poses.map((pose, i) => `Frame ${i + 1}: ${pose}`).join(". ");

  const gridDesc = rows === 1
    ? `${frameCount} frames in a single horizontal row`
    : `${frameCount} frames in a ${columns}x${rows} grid (${columns} columns, ${rows} rows)`;

  return (
    `A sprite sheet with exactly ${gridDesc}. ` +
    `Each frame shows the same scene: ${baseDescription}. ` +
    `The frames show a ${animation} animation sequence. ` +
    `${frameList}. ` +
    `Each transition between frames must be smooth and gradual -- only small incremental changes between consecutive frames. ` +
    `All ${frameCount} frames must have identical composition, identical proportions, ` +
    `identical colors, identical art style, and identical camera angle. ` +
    `The subject must stay in the exact same position and size across all frames. ` +
    `Each frame is the same size and evenly spaced in the grid.`
  );
}

/**
 * Pick the best API image size for a sprite sheet grid.
 */
function pickSheetSize(
  columns: number,
  rows: number
): "1024x1024" | "1536x1024" | "1024x1536" {
  if (rows === 1 && columns > 2) return "1536x1024"; // wide strip
  if (columns === 1 && rows > 2) return "1024x1536"; // tall strip
  if (columns > rows) return "1536x1024";
  if (rows > columns) return "1024x1536";
  return "1024x1024";
}

/**
 * Choose an internal grid layout that maximizes per-frame resolution.
 * The user's `columns` param controls the output sheet layout; this
 * picks the best generation grid for the API's fixed image sizes.
 */
function pickGenerationGrid(frameCount: number): { cols: number; rows: number } {
  // For a 1536x1024 canvas, prefer wider layouts (more cols)
  // For a 1024x1536 canvas, prefer taller layouts (more rows)
  // For 1024x1024, prefer square-ish grids
  if (frameCount <= 2) return { cols: 2, rows: 1 };
  if (frameCount <= 4) return { cols: 2, rows: 2 };
  if (frameCount <= 6) return { cols: 3, rows: 2 };
  if (frameCount <= 8) return { cols: 4, rows: 2 };
  if (frameCount <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: 4 }; // up to 16
}

/**
 * Generate a complete sprite sheet in a single API call, then split into
 * individual frames. The model generates all frames at once, which inherently
 * maintains character consistency since everything is in one image.
 */
export async function generateSingleSheet(
  generator: ImageGenerator,
  params: SpriteSheetParams,
  onProgress?: (step: string, progress: number, total: number) => void
): Promise<{ frames: Buffer[]; rawSheet: Buffer; frameWidth: number; frameHeight: number }> {
  // Use an internal grid optimized for resolution, not the user's output columns
  const genGrid = pickGenerationGrid(params.frameCount);
  const totalSteps = 4; // generate + split + center + done

  // Step 1: Generate the full sheet in one call
  onProgress?.("Generating sprite sheet (single image)", 1, totalSteps);

  const prompt = buildSheetPrompt(
    params.prompt,
    params.animation,
    params.frameCount,
    genGrid.cols,
    params.frameDescriptions
  );

  const size = pickSheetSize(genGrid.cols, genGrid.rows);
  const result = await generator.generate({
    prompt,
    type: "sprite_sheet",
    quality: params.quality,
    background: params.background ?? "transparent",
    outputDir: params.outputDir,
    width: parseInt(size.split("x")[0]),
    height: parseInt(size.split("x")[1]),
  });

  const fs = await import("node:fs");
  const sheetBuffer = fs.readFileSync(result.filePath);

  try {
    fs.unlinkSync(result.filePath);
  } catch {
    // Non-critical
  }

  // Step 2: Split into grid cells
  onProgress?.("Splitting into individual frames", 2, totalSteps);

  const cellWidth = Math.floor(result.width / genGrid.cols);
  const cellHeight = Math.floor(result.height / genGrid.rows);
  const rawFrames: Buffer[] = [];

  for (let row = 0; row < genGrid.rows; row++) {
    for (let col = 0; col < genGrid.cols; col++) {
      const frameIndex = row * genGrid.cols + col;
      if (frameIndex >= params.frameCount) break;

      const frame = await sharp(sheetBuffer)
        .extract({
          left: col * cellWidth,
          top: row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        })
        .png()
        .toBuffer();
      rawFrames.push(frame);
    }
  }

  // Step 3: Normalize frames
  // For transparent backgrounds: trim to bounding box and re-center (good for characters)
  // For opaque backgrounds: skip trim/center to keep frames pixel-aligned (good for scenes)
  const skipTrimCenter = params.background === "opaque";
  onProgress?.(skipTrimCenter ? "Normalizing frames" : "Centering and normalizing frames", 3, totalSteps);

  const targetSize = Math.max(cellWidth, cellHeight);
  const outputFrames: Buffer[] = [];

  if (skipTrimCenter) {
    // Opaque: resize raw grid cells to square, cropping to cover the canvas
    for (const frame of rawFrames) {
      const resized = await sharp(frame)
        .resize(targetSize, targetSize, { fit: "cover" })
        .png()
        .toBuffer();
      outputFrames.push(resized);
    }
  } else {
    // Transparent: pad raw cells to square without trimming.
    // Trimming (even with a union bounding box) amplifies tiny position
    // differences the AI produces across cells. Skipping trim preserves the
    // exact relative positions from the original sheet.
    for (const frame of rawFrames) {
      const resized = await sharp(frame)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .raw()
        .toBuffer();

      // Remove white fringing: semi-transparent near-white pixels at edges
      // that the AI renders inconsistently across frames.
      const pixels = new Uint8Array(resized);
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
        if (a > 0 && a < 128 && r > 200 && g > 200 && b > 200) {
          pixels[i + 3] = 0;
        }
      }

      const cleaned = await sharp(Buffer.from(pixels), {
        raw: { width: targetSize, height: targetSize, channels: 4 },
      })
        .png()
        .toBuffer();

      outputFrames.push(cleaned);
    }
  }

  onProgress?.("Frames ready", 4, totalSteps);

  return {
    frames: outputFrames,
    rawSheet: sheetBuffer,
    frameWidth: targetSize,
    frameHeight: targetSize,
  };
}

// ---------------------------------------------------------------------------
// Per-frame edit generation (fallback, more distinct poses)
// ---------------------------------------------------------------------------

/** Style anchor repeated on every prompt to fight style drift. */
const STYLE_ANCHOR =
  "same camera angle, same zoom level, same framing, same composition";

/** Preservation constraints appended to edit prompts. */
const PRESERVE_SUFFIX =
  "Keep the exact same subject, position, size, shape, colors, art style, proportions, " +
  "and background. Do not change or remove the background. " +
  "Only change what is explicitly described. Everything else must remain pixel-identical.";

/**
 * Build per-frame prompts. Returns separate generate (frame 1) and edit (frames 2-N) prompts.
 */
export function generateFramePrompts(
  baseDescription: string,
  animation: string,
  frameCount: number,
  customDescriptions?: string[]
): { generate: string; edits: string[] } {
  const poses = resolveFramePoses(animation, frameCount, customDescriptions);

  const generate =
    `${baseDescription}, ${poses[0]}, ${STYLE_ANCHOR}, ` +
    `same character same proportions same colors same art style`;

  const edits = poses.slice(1).map((pose) =>
    `Make this one small change to the image: ${pose}. ` +
    `${PRESERVE_SUFFIX} ${STYLE_ANCHOR}.`
  );

  return { generate, edits };
}

/**
 * Resolve pose descriptions for each frame from custom, preset, or generic sources.
 */
function resolveFramePoses(
  animation: string,
  frameCount: number,
  customDescriptions?: string[]
): string[] {
  if (customDescriptions && customDescriptions.length >= frameCount) {
    return customDescriptions.slice(0, frameCount);
  }

  const preset = ANIMATION_PRESETS[animation.toLowerCase()];
  if (preset) {
    return Array.from({ length: frameCount }, (_, i) => preset[i % preset.length]);
  }

  return Array.from({ length: frameCount }, (_, i) =>
    `distinct pose showing phase ${i + 1} of ${frameCount} in a ${animation} motion`
  );
}

/**
 * Create a horizontal preserve mask for the edit API (optional).
 */
export async function createPreserveMask(
  width: number,
  height: number,
  preservePercent: number
): Promise<Buffer> {
  const preserveH = Math.round(height * (preservePercent / 100));
  const editH = height - preserveH;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${preserveH}" fill="black" fill-opacity="1"/>
    <rect x="0" y="${preserveH}" width="${width}" height="${editH}" fill="black" fill-opacity="0"/>
  </svg>`;

  return sharp(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toBuffer();
}

/**
 * Generate frame 1 from scratch, then use the edit API for frames 2-N.
 * This mode produces more distinct poses but less character consistency.
 */
export async function generateFrames(
  generator: ImageGenerator,
  params: SpriteSheetParams,
  onProgress?: (step: string, progress: number, total: number) => void
): Promise<Buffer[]> {
  const { generate: generatePrompt, edits: editPrompts } = generateFramePrompts(
    params.prompt,
    params.animation,
    params.frameCount,
    params.frameDescriptions
  );

  const totalSteps = params.frameCount + 1;
  const buffers: Buffer[] = [];

  onProgress?.(
    `Generating base frame (1/${params.frameCount})`,
    1,
    totalSteps
  );

  const result = await generator.generate({
    prompt: generatePrompt,
    type: "game_sprite",
    quality: params.quality,
    background: params.background ?? "transparent",
    outputDir: params.outputDir,
  });

  const fs = await import("node:fs");
  const baseFrameBuffer = fs.readFileSync(result.filePath);
  buffers.push(baseFrameBuffer);

  try {
    fs.unlinkSync(result.filePath);
  } catch {
    // Non-critical
  }

  let maskBuffer: Buffer | undefined;
  if (params.maskPreserve != null && params.maskPreserve > 0 && params.maskPreserve < 100) {
    maskBuffer = await createPreserveMask(result.width, result.height, params.maskPreserve);
  }

  for (let i = 0; i < editPrompts.length; i++) {
    onProgress?.(
      `Editing frame ${i + 2}/${params.frameCount}`,
      i + 2,
      totalSteps
    );

    // Edit from the base frame each time to prevent cumulative drift
    const sourceBuffer = baseFrameBuffer;
    const editSize = `${result.width}x${result.height}` as "1024x1024" | "1536x1024" | "1024x1536";
    const editedBuffer = await generator.editImage(
      sourceBuffer,
      editPrompts[i],
      { quality: params.quality, size: editSize, mask: maskBuffer, background: params.background }
    );
    buffers.push(editedBuffer);
  }

  return buffers;
}

/**
 * Stitch individual frame buffers into a grid sprite sheet.
 */
export async function stitchFrames(
  frameBuffers: Buffer[],
  columns: number,
  frameWidth: number,
  frameHeight: number
): Promise<Buffer> {
  const rows = Math.ceil(frameBuffers.length / columns);
  const sheetWidth = columns * frameWidth;
  const sheetHeight = rows * frameHeight;

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < frameBuffers.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);

    const resizedFrame = await sharp(frameBuffers[i])
      .resize(frameWidth, frameHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    composites.push({
      input: resizedFrame,
      left: col * frameWidth,
      top: row * frameHeight,
    });
  }

  return sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
