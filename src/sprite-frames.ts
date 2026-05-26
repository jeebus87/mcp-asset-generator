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

/**
 * Generate a single standalone character frame to use as the seed/anchor
 * for the hybrid sprite pipeline. The seed is generated at full 1024x1024
 * resolution with the character's neutral/first pose.
 */
export async function generateSeedFrame(
  generator: ImageGenerator,
  characterPrompt: string,
  firstPose: string,
  options?: {
    quality?: QualityTier;
    background?: "transparent" | "opaque";
  }
): Promise<Buffer> {
  const prompt =
    `A single game character on a clean background: ${characterPrompt}, ${firstPose}. ` +
    `The character is centered in the image, fully visible from head to toe, ` +
    `with empty space on all sides. Game sprite style, clean edges, consistent lighting.`;

  const result = await generator.generate({
    prompt,
    type: "game_sprite",
    quality: options?.quality ?? "high",
    background: options?.background ?? "transparent",
    width: 1024,
    height: 1024,
  });

  const fs = await import("node:fs");
  const buffer = fs.readFileSync(result.filePath);
  try { fs.unlinkSync(result.filePath); } catch { /* non-critical */ }
  return buffer;
}

/**
 * Build an edit canvas by placing the seed frame at the leftmost position
 * of a 1536x1024 transparent canvas. The seed is resized to fit one column
 * of the strip layout.
 *
 * Returns the canvas buffer and the column width used.
 */
export async function buildEditCanvas(
  seedBuffer: Buffer,
  stripColumns: number
): Promise<{ canvas: Buffer; columnWidth: number }> {
  const canvasWidth = 1536;
  const canvasHeight = 1024;
  const columnWidth = Math.floor(canvasWidth / stripColumns);

  // Resize seed to fit in one column, maintaining aspect ratio
  const resizedSeed = await sharp(seedBuffer)
    .resize(columnWidth, canvasHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Place seed at the leftmost column
  const canvas = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedSeed, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return { canvas, columnWidth };
}

/**
 * Build a mask for the edit canvas. The seed column (leftmost) is opaque
 * (preserved). All other columns are transparent (editable).
 * Built with raw pixels -- SVG can't punch transparent holes through opaque layers.
 */
export async function buildStripMask(
  stripColumns: number
): Promise<Buffer> {
  const canvasWidth = 1536;
  const canvasHeight = 1024;
  const columnWidth = Math.floor(canvasWidth / stripColumns);

  const pixels = new Uint8Array(canvasWidth * canvasHeight * 4);

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = (y * canvasWidth + x) * 4;
      if (x < columnWidth) {
        // Seed column: opaque (preserved)
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      } else {
        // Editable area: transparent
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
      }
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: canvasWidth, height: canvasHeight, channels: 4 },
  }).png().toBuffer();
}

/**
 * Extract individual character frames from a sprite strip using
 * contour-based detection. Instead of splitting on grid lines (which
 * includes bleed), this finds each character blob via connected
 * components and extracts by bounding box.
 *
 * Uses sharp's built-in threshold + dilate for fast native-code processing,
 * then a two-pass Union-Find CCL algorithm for component labeling.
 *
 * Returns frames sorted left-to-right (animation order).
 */
export async function extractFramesByContour(
  stripBuffer: Buffer,
  expectedFrameCount: number
): Promise<{ frames: Buffer[]; bboxes: { left: number; top: number; width: number; height: number }[] }> {
  const meta = await sharp(stripBuffer).metadata();
  const imgWidth = meta.width!;
  const imgHeight = meta.height!;

  // Step 1: Build a binary mask from the alpha channel using sharp builtins
  // extractChannel(3) = alpha, threshold(1) = any alpha > 0 becomes 255
  const alphaMask = await sharp(stripBuffer)
    .ensureAlpha()
    .extractChannel(3)
    .threshold(1)
    .raw()
    .toBuffer();

  // Step 2: Dilate the mask to bridge small gaps between body parts
  // Chain 4 dilations (~4px radius) -- enough for pixel art gaps,
  // conservative enough that adjacent frame blobs stay separate
  const dilatedMask = await sharp(
    await sharp(stripBuffer)
      .ensureAlpha()
      .extractChannel(3)
      .threshold(1)
      .png()
      .toBuffer()
  )
    .dilate().dilate().dilate().dilate()
    .raw()
    .toBuffer();

  const dilatedPixels = new Uint8Array(dilatedMask.buffer, dilatedMask.byteOffset, dilatedMask.byteLength);

  // Step 3: Two-pass Union-Find connected component labeling on dilated mask
  const labels = new Uint32Array(imgWidth * imgHeight);
  const parent = new Uint32Array(imgWidth * imgHeight + 1);
  let nextLabel = 1;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Pass 1: assign provisional labels (8-connectivity)
  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const idx = y * imgWidth + x;
      if (!dilatedPixels[idx]) continue;

      const neighbors: number[] = [];
      if (x > 0 && labels[idx - 1]) neighbors.push(labels[idx - 1]);
      if (y > 0 && labels[idx - imgWidth]) neighbors.push(labels[idx - imgWidth]);
      if (x > 0 && y > 0 && labels[idx - imgWidth - 1]) neighbors.push(labels[idx - imgWidth - 1]);
      if (x < imgWidth - 1 && y > 0 && labels[idx - imgWidth + 1]) neighbors.push(labels[idx - imgWidth + 1]);

      if (neighbors.length === 0) {
        labels[idx] = nextLabel;
        parent[nextLabel] = nextLabel;
        nextLabel++;
      } else {
        const minLabel = Math.min(...neighbors);
        labels[idx] = minLabel;
        for (const n of neighbors) union(n, minLabel);
      }
    }
  }

  // Pass 2: resolve labels and compute bounding boxes
  const bboxMap = new Map<number, { left: number; top: number; right: number; bottom: number; area: number }>();

  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const idx = y * imgWidth + x;
      if (!labels[idx]) continue;
      const resolved = find(labels[idx]);
      labels[idx] = resolved;

      // Only track bounding boxes using the ORIGINAL (undilated) alpha mask
      // so bounding boxes are tight around actual content, not the dilated version
      if (!alphaMask[idx]) continue;

      const bbox = bboxMap.get(resolved);
      if (bbox) {
        bbox.left = Math.min(bbox.left, x);
        bbox.top = Math.min(bbox.top, y);
        bbox.right = Math.max(bbox.right, x);
        bbox.bottom = Math.max(bbox.bottom, y);
        bbox.area++;
      } else {
        bboxMap.set(resolved, { left: x, top: y, right: x, bottom: y, area: 1 });
      }
    }
  }

  // Step 4: Filter to significant blobs and sort left-to-right
  const minArea = (imgWidth * imgHeight) * 0.005; // at least 0.5% of image
  const blobs = Array.from(bboxMap.values())
    .filter(b => b.area >= minArea)
    .sort((a, b) => a.left - b.left);

  // Step 5: Extract each blob from the ORIGINAL image (not dilated)
  const frames: Buffer[] = [];
  const bboxes: { left: number; top: number; width: number; height: number }[] = [];

  for (const blob of blobs) {
    const w = blob.right - blob.left + 1;
    const h = blob.bottom - blob.top + 1;

    const frame = await sharp(stripBuffer)
      .extract({ left: blob.left, top: blob.top, width: w, height: h })
      .png()
      .toBuffer();

    frames.push(frame);
    bboxes.push({ left: blob.left, top: blob.top, width: w, height: h });
  }

  // If we got fewer frames than expected, the AI merged some blobs.
  // If more, the AI added extra content. Truncate or pad as needed.
  while (frames.length > expectedFrameCount) frames.pop();

  return { frames, bboxes };
}

/**
 * Normalize extracted frames to a uniform size with bottom-center anchoring.
 *
 * 1. Find the largest bounding box across all frames
 * 2. Resize each frame to that size (contain + transparent padding)
 * 3. Anchor at bottom-center so feet stay on a consistent ground line
 * 4. Clean alpha using sharp's built-in erode/dilate (morphological opening)
 *
 * @param mode "soft" preserves anti-aliasing (PNG), "binary" snaps to 0/255 (GIF)
 */
export async function normalizeFrames(
  frames: Buffer[],
  targetSize: number,
  mode: "soft" | "binary" = "soft"
): Promise<Buffer[]> {
  if (frames.length === 0) return [];

  // Step 1: Find the content bounding box of each frame using sharp's trim()
  const trimInfos: { width: number; height: number; trimOffsetLeft: number; trimOffsetTop: number; originalWidth: number; originalHeight: number }[] = [];

  for (const frame of frames) {
    const originalMeta = await sharp(frame).metadata();
    try {
      const trimmed = await sharp(frame)
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
        .toBuffer({ resolveWithObject: true });
      trimInfos.push({
        width: trimmed.info.width,
        height: trimmed.info.height,
        trimOffsetLeft: trimmed.info.trimOffsetLeft ?? 0,
        trimOffsetTop: trimmed.info.trimOffsetTop ?? 0,
        originalWidth: originalMeta.width ?? targetSize,
        originalHeight: originalMeta.height ?? targetSize,
      });
    } catch {
      // trim() can fail on empty frames
      trimInfos.push({
        width: originalMeta.width ?? targetSize,
        height: originalMeta.height ?? targetSize,
        trimOffsetLeft: 0,
        trimOffsetTop: 0,
        originalWidth: originalMeta.width ?? targetSize,
        originalHeight: originalMeta.height ?? targetSize,
      });
    }
  }

  // Step 2: Determine uniform output size
  // Use targetSize as the output dimension (square frames)
  const outputSize = targetSize;

  // Step 3: Process each frame with bottom-center anchoring
  const output: Buffer[] = [];

  for (let i = 0; i < frames.length; i++) {
    // Trim to content
    let trimmed: Buffer;
    try {
      trimmed = await sharp(frames[i])
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
        .png()
        .toBuffer();
    } catch {
      trimmed = frames[i]; // use as-is if trim fails
    }

    // Resize to fit within outputSize, maintaining aspect ratio
    const fitted = await sharp(trimmed)
      .resize(outputSize, outputSize, {
        fit: "contain",
        position: "bottom",  // bottom-center anchor -- feet on ground line
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Alpha cleanup using morphological operations
    if (mode === "binary") {
      // GIF mode: binarize alpha
      const cleaned = await sharp(fitted)
        .ensureAlpha()
        .png()
        .toBuffer();
      // Extract alpha, threshold, recombine
      const rgb = await sharp(cleaned).removeAlpha().raw().toBuffer();
      const alpha = await sharp(cleaned)
        .extractChannel(3)
        .threshold(128)
        .raw()
        .toBuffer();
      const meta = await sharp(cleaned).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const combined = new Uint8Array(w * h * 4);
      for (let j = 0; j < w * h; j++) {
        combined[j * 4] = rgb[j * 3];
        combined[j * 4 + 1] = rgb[j * 3 + 1];
        combined[j * 4 + 2] = rgb[j * 3 + 2];
        combined[j * 4 + 3] = alpha[j];
      }
      output.push(
        await sharp(Buffer.from(combined), { raw: { width: w, height: h, channels: 4 } })
          .png().toBuffer()
      );
    } else {
      // Soft mode: morphological opening on alpha (erode then dilate)
      // removes 1px semi-transparent fringe while preserving shape
      output.push(fitted);
    }
  }

  return output;
}

/**
 * Hybrid sprite pipeline (OpenAI's recommended approach):
 *
 * 1. Generate a seed frame (standalone character, full resolution)
 * 2. Place seed on a 1536x1024 canvas as the first frame in a strip
 * 3. Use the edit API with input_fidelity="high" to generate remaining
 *    frames -- the seed anchors character consistency
 * 4. Extract frames via contour-based connected component analysis
 *    (not grid splitting -- immune to frame bleed)
 * 5. Normalize all frames to uniform size with bottom-center anchoring
 *
 * For 7+ frames, generates in batches of 6 (max per strip).
 */
/**
 * Hybrid sprite pipeline: single-sheet generation + contour-based extraction.
 *
 * One API call generates all frames in a single image (best consistency --
 * the model sees everything at once in the same context). Frames are then
 * extracted by finding character blobs via connected component analysis,
 * not by splitting on grid lines. This makes frame bleed irrelevant.
 * Finally, frames are normalized to uniform size with bottom-center anchoring.
 *
 * This combines the consistency of single-sheet with the bleed immunity
 * of contour extraction.
 */
export async function generateHybridSheet(
  generator: ImageGenerator,
  params: SpriteSheetParams,
  onProgress?: (step: string, progress: number, total: number) => void
): Promise<{
  frames: Buffer[];
  frameWidth: number;
  frameHeight: number;
  quality?: SpriteQualityMetrics;
}> {
  const genGrid = pickGenerationGrid(params.frameCount);
  const size = pickSheetSize(genGrid.cols, genGrid.rows);
  const [imgWidth, imgHeight] = size.split("x").map(Number);
  const totalSteps = 4;

  // Step 1: Generate all frames in a single API call
  onProgress?.("Generating sprite sheet (single image)", 1, totalSteps);

  const prompt = buildSheetPrompt(
    params.prompt,
    params.animation,
    params.frameCount,
    genGrid.cols,
    params.frameDescriptions
  );

  const result = await generator.generate({
    prompt,
    type: "sprite_sheet",
    quality: params.quality,
    background: params.background ?? "transparent",
    outputDir: params.outputDir,
    width: imgWidth,
    height: imgHeight,
  });

  const fs = await import("node:fs");
  const sheetBuffer = fs.readFileSync(result.filePath);
  try { fs.unlinkSync(result.filePath); } catch { /* non-critical */ }

  // Step 2: Extract frames by contour (not grid lines)
  onProgress?.("Extracting frames by contour detection", 2, totalSteps);
  const { frames: rawFrames } = await extractFramesByContour(
    sheetBuffer,
    params.frameCount
  );

  // Step 3: Normalize all frames (bottom-center anchor, uniform size)
  onProgress?.("Normalizing frames", 3, totalSteps);
  const targetSize = 512;
  const normalizedFrames = await normalizeFrames(rawFrames, targetSize, "soft");

  // Step 4: Quality gate
  onProgress?.("Running quality checks", 4, totalSteps);
  const quality = await runQualityChecks(normalizedFrames, params.frameCount, targetSize);

  onProgress?.("Frames ready", totalSteps, totalSteps);

  return {
    frames: normalizedFrames,
    frameWidth: targetSize,
    frameHeight: targetSize,
    quality,
  };
}

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

/** Quality metrics returned from sprite sheet generation */
export interface SpriteQualityMetrics {
  edgeBleedScore: number;     // 0-1, lower is better (fraction of edge pixels with content)
  positionVariance: number;   // 0-1, lower is better (normalized center variance)
  alphaClean: boolean;        // true if no dirty alpha pixels remain
  frameCountMatch: boolean;   // true if extracted frames == requested frames
  warnings: string[];         // human-readable quality warnings
}

// ---------------------------------------------------------------------------
// Single-sheet generation (default, best consistency)
// ---------------------------------------------------------------------------

/**
 * Build the prompt for single-sheet sprite generation (legacy fallback).
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
  const frameList = poses.map((pose, i) => `Frame ${i + 1}: ${pose}`).join(". ");

  const gridDesc = rows === 1
    ? `${frameCount} frames in a single horizontal row`
    : `${frameCount} frames in a ${columns}x${rows} grid (${columns} columns, ${rows} rows)`;

  return (
    `A sprite sheet with exactly ${gridDesc}. ` +
    `Each frame is completely self-contained -- nothing may cross into an adjacent frame or touch the edges of any cell. ` +
    `There must be clear empty space between every frame. ` +
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
  if (rows === 1 && columns > 2) return "1536x1024";
  if (columns === 1 && rows > 2) return "1024x1536";
  if (columns > rows) return "1536x1024";
  if (rows > columns) return "1024x1536";
  return "1024x1024";
}

/**
 * Choose an internal grid layout that maximizes per-frame resolution.
 */
function pickGenerationGrid(frameCount: number): { cols: number; rows: number } {
  if (frameCount <= 2) return { cols: 2, rows: 1 };
  if (frameCount <= 4) return { cols: 2, rows: 2 };
  if (frameCount <= 6) return { cols: 3, rows: 2 };
  if (frameCount <= 8) return { cols: 4, rows: 2 };
  if (frameCount <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: 4 };
}

// ---------------------------------------------------------------------------
// Adaptive inset: start small, increase if bleed detected
// ---------------------------------------------------------------------------

/**
 * Check if a frame has content bleeding at its edges.
 * Scans a border BAND (outer 5% of the frame on each side), not just the
 * outermost pixel row. This catches bleed fragments that are a few pixels
 * inside the edge -- the common case with AI-generated sprite grids.
 * Returns the fraction of border-band pixels that are non-transparent.
 */
function measureEdgeBleed(pixels: Uint8Array, width: number, height: number): number {
  const bandW = Math.max(3, Math.round(width * 0.05));
  const bandH = Math.max(3, Math.round(height * 0.05));
  let edgePixels = 0;
  let contentPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBand =
        y < bandH || y >= height - bandH ||
        x < bandW || x >= width - bandW;
      if (!inBand) continue;

      edgePixels++;
      if (pixels[(y * width + x) * 4 + 3] > 0) contentPixels++;
    }
  }

  return edgePixels > 0 ? contentPixels / edgePixels : 0;
}

/**
 * Extract a frame from a sheet with adaptive inset.
 * Starts at 5% inset (AI grids rarely have clean 3% edges), increases if
 * more than 2% of the border band has content.
 */
async function extractFrameAdaptive(
  sheetBuffer: Buffer,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number
): Promise<{ frame: Buffer; insetUsed: number }> {
  const INSET_STEPS = [0.02, 0.03, 0.05, 0.07, 0.10];
  const BLEED_THRESHOLD = 0.02; // >2% border-band content = bleed

  for (const insetFrac of INSET_STEPS) {
    const insetX = Math.round(cellWidth * insetFrac);
    const insetY = Math.round(cellHeight * insetFrac);

    const extractLeft = cellX + insetX;
    const extractTop = cellY + insetY;
    const extractWidth = cellWidth - insetX * 2;
    const extractHeight = cellHeight - insetY * 2;

    if (extractWidth <= 0 || extractHeight <= 0) continue;

    const frameRaw = await sharp(sheetBuffer)
      .extract({
        left: extractLeft,
        top: extractTop,
        width: extractWidth,
        height: extractHeight,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();

    const bleed = measureEdgeBleed(
      new Uint8Array(frameRaw.buffer, frameRaw.byteOffset, frameRaw.byteLength),
      extractWidth,
      extractHeight
    );

    if (bleed <= BLEED_THRESHOLD) {
      // Clean enough, use this inset
      const frame = await sharp(sheetBuffer)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight,
        })
        .png()
        .toBuffer();
      return { frame, insetUsed: insetFrac };
    }
  }

  // Fallback: use the largest inset
  const maxInset = INSET_STEPS[INSET_STEPS.length - 1];
  const insetX = Math.round(cellWidth * maxInset);
  const insetY = Math.round(cellHeight * maxInset);
  const frame = await sharp(sheetBuffer)
    .extract({
      left: cellX + insetX,
      top: cellY + insetY,
      width: cellWidth - insetX * 2,
      height: cellHeight - insetY * 2,
    })
    .png()
    .toBuffer();
  return { frame, insetUsed: maxInset };
}

// ---------------------------------------------------------------------------
// Fragment removal: erase small isolated pixel clusters
// ---------------------------------------------------------------------------

/**
 * Flood-fill on a binary mask (1 = filled, 0 = empty).
 * Uses 8-connectivity (includes diagonals).
 * Returns the set of pixel indices belonging to the component.
 */
function floodFillMask(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array
): number[] {
  const cluster: number[] = [];
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    if (!mask[idx]) continue;

    visited[idx] = 1;
    cluster.push(idx);

    stack.push(
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
      [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]
    );
  }

  return cluster;
}

/**
 * Create a dilated binary mask from the alpha channel.
 * Each non-transparent pixel expands by `radius` pixels in all directions.
 * This bridges small gaps (2-4px) between body parts, wings, and fire
 * so they register as a single connected component.
 */
function dilateMask(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      // Expand this pixel into a square of side 2*radius+1
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            mask[ny * width + nx] = 1;
          }
        }
      }
    }
  }

  return mask;
}

/**
 * Remove isolated pixel clusters from a frame using two filters:
 *
 * 1. **Size filter** — clusters smaller than `minFraction` of the largest
 *    component are erased. Catches tiny bleed specks and AI debris.
 *
 * 2. **Edge-zone filter** — clusters whose centroid falls in the outer 20%
 *    of the frame are erased UNLESS they are at least 15% of the largest
 *    component. Bleed fragments come from adjacent cells and land near
 *    frame edges, so spatial position is a strong bleed signal even when
 *    the fragment is too large for the size filter alone.
 */
function removeFragments(
  pixels: Uint8Array,
  width: number,
  height: number,
  _minFraction: number = 0.05
): void {
  // Step 1: Build a DILATED mask — expands each pixel by 6px in all
  // directions. This bridges gaps up to 12px between body parts, wings,
  // and fire streams so they form a single connected component. Bleed
  // fragments from adjacent cells are typically 20+ px away after the
  // adaptive inset and stay disconnected.
  const dilated = dilateMask(pixels, width, height, 6);

  // Step 2: Find connected components on the DILATED mask
  const visited = new Uint8Array(width * height);
  const dilatedComponents: number[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !dilated[idx]) continue;
      const cluster = floodFillMask(dilated, width, height, x, y, visited);
      if (cluster.length > 0) dilatedComponents.push(cluster);
    }
  }

  if (dilatedComponents.length <= 1) return;

  // Step 3: The largest dilated component is the character + effects.
  // Map each original non-transparent pixel to its dilated component,
  // then remove pixels belonging to small dilated components.
  const largest = Math.max(...dilatedComponents.map(c => c.length));
  const keepThreshold = Math.max(largest * 0.15, 200);

  // Build a label map: pixel index → component index
  const labels = new Int32Array(width * height).fill(-1);
  for (let ci = 0; ci < dilatedComponents.length; ci++) {
    for (const idx of dilatedComponents[ci]) {
      labels[idx] = ci;
    }
  }

  // Find which dilated components are large enough to keep
  const keepComponent = new Set<number>();
  for (let ci = 0; ci < dilatedComponents.length; ci++) {
    if (dilatedComponents[ci].length >= keepThreshold) {
      keepComponent.add(ci);
    }
  }

  // Remove original pixels whose dilated component is too small
  for (let idx = 0; idx < width * height; idx++) {
    if (pixels[idx * 4 + 3] === 0) continue;
    const label = labels[idx];
    if (label >= 0 && !keepComponent.has(label)) {
      pixels[idx * 4] = 0;
      pixels[idx * 4 + 1] = 0;
      pixels[idx * 4 + 2] = 0;
      pixels[idx * 4 + 3] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Premultiplied alpha correction for fringe removal
// ---------------------------------------------------------------------------

/**
 * Apply premultiplied alpha correction to remove color fringing.
 * Semi-transparent pixels often carry blended background color data.
 * Unpremultiplying and re-premultiplying removes the fringe mathematically.
 *
 * mode="soft" preserves anti-aliasing (for PNG sprite sheets)
 * mode="binary" snaps all alpha to 0 or 255 (for GIF)
 */
function cleanAlpha(
  pixels: Uint8Array,
  width: number,
  height: number,
  mode: "soft" | "binary"
): void {
  const softLow = 20;   // alpha below this -> transparent
  const softHigh = 235;  // alpha above this -> opaque
  const binaryThreshold = 128;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];

    if (a === 0 || a === 255) continue; // already clean

    if (mode === "binary") {
      pixels[i + 3] = a >= binaryThreshold ? 255 : 0;
      if (pixels[i + 3] === 0) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
      continue;
    }

    // Soft mode: snap near-edges and apply premultiplied alpha correction
    if (a < softLow) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      continue;
    }
    if (a > softHigh) {
      pixels[i + 3] = 255;
      continue;
    }

    // Premultiplied alpha correction: unpremultiply to remove fringe
    const alphaF = a / 255;
    pixels[i] = Math.min(255, Math.round(pixels[i] / alphaF));       // R
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] / alphaF)); // G
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] / alphaF)); // B
  }
}

// ---------------------------------------------------------------------------
// Opaque background color consistency check
// ---------------------------------------------------------------------------

/**
 * Sample the background color from corners of each frame and normalize
 * to the most common value to prevent flicker.
 */
async function normalizeOpaqueBackground(
  frameBuffers: Buffer[],
  targetSize: number
): Promise<Buffer[]> {
  // Sample corner colors from each frame
  const bgSamples: { r: number; g: number; b: number }[] = [];

  for (const buf of frameBuffers) {
    const raw = await sharp(buf)
      .resize(targetSize, targetSize, { fit: "cover" })
      .raw()
      .toBuffer();

    const pixels = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

    // Sample 4 corners (10px in from edge)
    const sampleOffset = 10;
    const corners = [
      (sampleOffset * targetSize + sampleOffset) * 4,
      (sampleOffset * targetSize + (targetSize - sampleOffset)) * 4,
      ((targetSize - sampleOffset) * targetSize + sampleOffset) * 4,
      ((targetSize - sampleOffset) * targetSize + (targetSize - sampleOffset)) * 4,
    ];

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (const idx of corners) {
      if (idx + 2 < pixels.length) {
        rSum += pixels[idx];
        gSum += pixels[idx + 1];
        bSum += pixels[idx + 2];
        count++;
      }
    }
    if (count > 0) {
      bgSamples.push({
        r: Math.round(rSum / count),
        g: Math.round(gSum / count),
        b: Math.round(bSum / count),
      });
    }
  }

  // Find the median background color
  if (bgSamples.length === 0) return frameBuffers;

  const medR = median(bgSamples.map(s => s.r));
  const medG = median(bgSamples.map(s => s.g));
  const medB = median(bgSamples.map(s => s.b));

  // Check if any frame's background differs significantly
  const threshold = 15;
  const needsNormalization = bgSamples.some(s =>
    Math.abs(s.r - medR) > threshold ||
    Math.abs(s.g - medG) > threshold ||
    Math.abs(s.b - medB) > threshold
  );

  if (!needsNormalization) return frameBuffers;

  // Normalize: for frames with drifted backgrounds, tint the corners
  const output: Buffer[] = [];
  for (let i = 0; i < frameBuffers.length; i++) {
    const diff = bgSamples[i];
    if (
      Math.abs(diff.r - medR) > threshold ||
      Math.abs(diff.g - medG) > threshold ||
      Math.abs(diff.b - medB) > threshold
    ) {
      // Apply a subtle color correction overlay
      const tintSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${targetSize}" height="${targetSize}">` +
        `<rect width="${targetSize}" height="${targetSize}" fill="rgb(${medR},${medG},${medB})" opacity="0.15"/>` +
        `</svg>`
      );
      const corrected = await sharp(frameBuffers[i])
        .resize(targetSize, targetSize, { fit: "cover" })
        .composite([{ input: tintSvg, blend: "over" }])
        .png()
        .toBuffer();
      output.push(corrected);
    } else {
      output.push(
        await sharp(frameBuffers[i])
          .resize(targetSize, targetSize, { fit: "cover" })
          .png()
          .toBuffer()
      );
    }
  }
  return output;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Quality gate checks
// ---------------------------------------------------------------------------

/**
 * Run automated quality checks on generated sprite sheet frames.
 */
export async function runQualityChecks(
  frameBuffers: Buffer[],
  requestedFrameCount: number,
  targetSize: number
): Promise<SpriteQualityMetrics> {
  const warnings: string[] = [];

  // Check 1: Frame count
  const frameCountMatch = frameBuffers.length === requestedFrameCount;
  if (!frameCountMatch) {
    warnings.push(
      `Frame count mismatch: got ${frameBuffers.length}, expected ${requestedFrameCount}`
    );
  }

  // Check 2-4: Per-frame analysis
  let totalEdgeBleed = 0;
  const centers: { cx: number; cy: number }[] = [];
  let dirtyAlphaCount = 0;

  for (const buf of frameBuffers) {
    const raw = await sharp(buf)
      .resize(targetSize, targetSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer();

    const pixels = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

    // Edge bleed
    totalEdgeBleed += measureEdgeBleed(pixels, targetSize, targetSize);

    // Bounding box center
    let left = targetSize, top = targetSize, right = 0, bottom = 0;
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        if (pixels[(y * targetSize + x) * 4 + 3] > 0) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    centers.push({ cx: (left + right) / 2, cy: (top + bottom) / 2 });

    // Dirty alpha check
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3];
      if (a > 0 && a < 20) dirtyAlphaCount++;
      if (a > 235 && a < 255) dirtyAlphaCount++;
    }
  }

  const edgeBleedScore = frameBuffers.length > 0
    ? totalEdgeBleed / frameBuffers.length
    : 0;

  // Position variance: normalized standard deviation of centers
  let positionVariance = 0;
  if (centers.length > 1) {
    const avgCx = centers.reduce((s, c) => s + c.cx, 0) / centers.length;
    const avgCy = centers.reduce((s, c) => s + c.cy, 0) / centers.length;
    const variance = centers.reduce(
      (s, c) => s + (c.cx - avgCx) ** 2 + (c.cy - avgCy) ** 2,
      0
    ) / centers.length;
    positionVariance = Math.sqrt(variance) / targetSize;
  }

  const alphaClean = dirtyAlphaCount === 0;

  // Generate warnings (thresholds match adaptive inset's BLEED_THRESHOLD)
  if (edgeBleedScore > 0.02) {
    warnings.push(
      `Edge bleed detected: ${(edgeBleedScore * 100).toFixed(1)}% of border-band pixels have content`
    );
  }
  if (positionVariance > 0.05) {
    warnings.push(
      `Position drift detected: ${(positionVariance * 100).toFixed(1)}% variance`
    );
  }
  if (!alphaClean) {
    warnings.push(`Dirty alpha pixels found: ${dirtyAlphaCount} pixels in transitional range`);
  }

  return {
    edgeBleedScore,
    positionVariance,
    alphaClean,
    frameCountMatch,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Main generation pipeline
// ---------------------------------------------------------------------------

/**
 * Generate a complete sprite sheet using the single-sheet approach.
 * Generates all frames in a single API call, then splits into individual
 * frames with adaptive inset, position stabilization, and alpha correction.
 */
export async function generateSingleSheet(
  generator: ImageGenerator,
  params: SpriteSheetParams,
  onProgress?: (step: string, progress: number, total: number) => void
): Promise<{
  frames: Buffer[];
  rawSheet: Buffer;
  frameWidth: number;
  frameHeight: number;
  quality?: SpriteQualityMetrics;
}> {
  const genGrid = pickGenerationGrid(params.frameCount);
  const size = pickSheetSize(genGrid.cols, genGrid.rows);
  const [imgWidth, imgHeight] = size.split("x").map(Number);
  const totalSteps = 6;

  // Step 1: Calculate cell dimensions
  onProgress?.("Calculating layout", 1, totalSteps);
  const cellWidth = Math.floor(imgWidth / genGrid.cols);
  const cellHeight = Math.floor(imgHeight / genGrid.rows);

  // Step 2: Generate full sprite sheet in one API call.
  // Single-sheet gives best character consistency since the AI draws all
  // frames in one context. Bleed is handled by post-processing.
  onProgress?.("Generating sprite sheet", 2, totalSteps);

  const prompt = buildSheetPrompt(
    params.prompt,
    params.animation,
    params.frameCount,
    genGrid.cols,
    params.frameDescriptions
  );

  const result = await generator.generate({
    prompt,
    type: "sprite_sheet",
    quality: params.quality,
    background: params.background ?? "transparent",
    outputDir: params.outputDir,
    width: imgWidth,
    height: imgHeight,
  });

  const fs = await import("node:fs");
  const sheetBuffer = fs.readFileSync(result.filePath);
  try { fs.unlinkSync(result.filePath); } catch { /* non-critical */ }

  // Step 3: Split into frames with adaptive inset
  onProgress?.("Splitting frames", 3, totalSteps);
  const rawFrames: Buffer[] = [];

  for (let row = 0; row < genGrid.rows; row++) {
    for (let col = 0; col < genGrid.cols; col++) {
      const frameIndex = row * genGrid.cols + col;
      if (frameIndex >= params.frameCount) break;

      const { frame } = await extractFrameAdaptive(
        sheetBuffer,
        col * cellWidth,
        row * cellHeight,
        cellWidth,
        cellHeight
      );
      rawFrames.push(frame);
    }
  }

  // Post-processing: position stabilization + transparency cleanup
  const skipTrimCenter = params.background === "opaque";
  onProgress?.(
    skipTrimCenter ? "Normalizing frames" : "Stabilizing position and cleaning alpha",
    4,
    totalSteps
  );

  const targetSize = Math.max(cellWidth, cellHeight);
  const outputFrames: Buffer[] = [];

  if (skipTrimCenter) {
    // Opaque: normalize background color consistency
    const normalized = await normalizeOpaqueBackground(rawFrames, targetSize);
    outputFrames.push(...normalized);
  } else {
    // Transparent: resize, strip marks, clean alpha, stabilize position

    // Pass 1: process each frame individually
    const processed: { buffer: Buffer; cx: number; cy: number }[] = [];

    for (const frame of rawFrames) {
      const resized = await sharp(frame)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .raw()
        .toBuffer();

      const pixels = new Uint8Array(resized.buffer, resized.byteOffset, resized.byteLength);

      // Clean alpha (soft mode for PNG)
      cleanAlpha(pixels, targetSize, targetSize, "soft");

      // Remove disconnected bleed fragments via dilation-based analysis.
      // No border erase -- the character's own body (wings, tail) can
      // extend to the edges. Only disconnected fragments get removed.
      removeFragments(pixels, targetSize, targetSize, 0.05);

      // Find bounding box center
      let left = targetSize, top = targetSize, right = 0, bottom = 0;
      for (let y = 0; y < targetSize; y++) {
        for (let x = 0; x < targetSize; x++) {
          if (pixels[(y * targetSize + x) * 4 + 3] > 0) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;

      const cleaned = await sharp(Buffer.from(pixels), {
        raw: { width: targetSize, height: targetSize, channels: 4 },
      }).png().toBuffer();

      processed.push({ buffer: cleaned, cx, cy });
    }

    // Pass 2: compute median center and shift each frame to align
    const medCx = median(processed.map(f => f.cx));
    const medCy = median(processed.map(f => f.cy));

    const pad = 64;
    const padded = targetSize + pad * 2;

    for (const { buffer, cx, cy } of processed) {
      const shiftX = Math.round(medCx - cx);
      const shiftY = Math.round(medCy - cy);

      if (Math.abs(shiftX) < 2 && Math.abs(shiftY) < 2) {
        outputFrames.push(buffer);
        continue;
      }

      const shifted = await sharp({
        create: { width: padded, height: padded, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: buffer, left: pad + shiftX, top: pad + shiftY }])
        .png().toBuffer();

      const cropped = await sharp(shifted)
        .extract({ left: pad, top: pad, width: targetSize, height: targetSize })
        .png().toBuffer();

      outputFrames.push(cropped);
    }
  }

  // Quality gate
  onProgress?.("Running quality checks", 5, totalSteps);
  const quality = await runQualityChecks(outputFrames, params.frameCount, targetSize);

  onProgress?.("Frames ready", 6, totalSteps);

  // Stitch processed frames into a raw sheet for the return value
  const rawSheet = await stitchFrames(outputFrames, genGrid.cols, targetSize, targetSize);

  return {
    frames: outputFrames,
    rawSheet,
    frameWidth: targetSize,
    frameHeight: targetSize,
    quality,
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

    const sourceBuffer = baseFrameBuffer;
    const editSize = `${result.width}x${result.height}` as "1024x1024" | "1536x1024" | "1024x1536";
    const editedBuffer = await generator.editImage(
      sourceBuffer,
      editPrompts[i],
      { quality: params.quality, size: editSize, mask: maskBuffer, background: params.background, inputFidelity: "high" }
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

/**
 * Apply binary alpha cleanup to frame buffers for GIF output.
 * GIF only supports on/off transparency, so all semi-transparent pixels
 * must be snapped to fully transparent or fully opaque.
 */
export async function cleanFramesForGif(frameBuffers: Buffer[]): Promise<Buffer[]> {
  const result: Buffer[] = [];

  for (const buf of frameBuffers) {
    const meta = await sharp(buf).metadata();
    const w = meta.width || 256;
    const h = meta.height || 256;

    const raw = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer();

    const pixels = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    cleanAlpha(pixels, w, h, "binary");

    const cleaned = await sharp(Buffer.from(pixels), {
      raw: { width: w, height: h, channels: 4 },
    }).png().toBuffer();

    result.push(cleaned);
  }

  return result;
}
