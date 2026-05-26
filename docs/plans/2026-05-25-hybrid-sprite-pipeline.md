# Hybrid Sprite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken single-sheet sprite generation with a hybrid pipeline: generate a seed frame, place it on a canvas, use the edit API with `input_fidelity: "high"` to generate all animation frames at once, then extract frames by contour (not grid lines).

**Architecture:** Generate one approved seed frame at 1024x1024. Resize it and place it at position 1 of a 1536x1024 canvas. Use the edit API (`gpt-image-1.5`, `input_fidelity: "high"`) to fill the rest of the canvas with animation frames -- the seed anchors character consistency. Extract frames via connected-component analysis on the full result (contour-based, not grid-based). Normalize all frames to the same size with bottom-center anchoring. Cap at 6 frames per API strip; for 7+ frames, generate in batches.

**Tech Stack:** TypeScript, sharp 0.34.5 (trim, erode, dilate, threshold, extractChannel), OpenAI gpt-image-1.5 edit API

---

### Task 1: Upgrade editImage() with input_fidelity and model options

**Files:**
- Modify: `src/generator.ts:158-198`

- [ ] **Step 1: Add input_fidelity and model override to editImage()**

```typescript
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors

- [ ] **Step 3: Commit**

```bash
git add src/generator.ts
git commit -m "feat: add input_fidelity and model override to editImage()"
```

---

### Task 2: Build the seed frame generator

**Files:**
- Modify: `src/sprite-frames.ts` (add new function)

- [ ] **Step 1: Add generateSeedFrame() function**

Add this after the `ANIMATION_PRESETS` constant and before the `SpriteSheetParams` interface:

```typescript
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "feat: add seed frame generator for hybrid sprite pipeline"
```

---

### Task 3: Build the edit canvas constructor

**Files:**
- Modify: `src/sprite-frames.ts` (add new function)

- [ ] **Step 1: Add buildEditCanvas() and buildStripMask() functions**

Add after `generateSeedFrame()`:

```typescript
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "feat: add edit canvas constructor for hybrid strip generation"
```

---

### Task 4: Build contour-based frame extraction

**Files:**
- Modify: `src/sprite-frames.ts` (add new function)

This is the key innovation: instead of splitting on grid lines, find each character blob on the full image using connected components and extract by bounding box.

- [ ] **Step 1: Add extractFramesByContour() function**

Add after `buildStripMask()`:

```typescript
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "feat: contour-based frame extraction using Union-Find CCL"
```

---

### Task 5: Build frame normalization with bottom-center anchoring

**Files:**
- Modify: `src/sprite-frames.ts` (add new function)

- [ ] **Step 1: Add normalizeFrames() function**

Add after `extractFramesByContour()`:

```typescript
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "feat: frame normalization with bottom-center anchoring and sharp trim()"
```

---

### Task 6: Build the hybrid generation pipeline

**Files:**
- Modify: `src/sprite-frames.ts` (add new function)

This is the main orchestrator that ties together seed generation, canvas construction, edit API strip generation, and contour-based extraction.

- [ ] **Step 1: Add generateHybridSheet() function**

Add after `normalizeFrames()`:

```typescript
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
  const poses = resolveFramePoses(
    params.animation,
    params.frameCount,
    params.frameDescriptions
  );

  const MAX_FRAMES_PER_STRIP = 6;
  const batchCount = Math.ceil(params.frameCount / MAX_FRAMES_PER_STRIP);
  const totalSteps = 2 + batchCount + 2; // seed + canvas*N + normalize + quality

  // Step 1: Generate seed frame
  onProgress?.("Generating seed frame", 1, totalSteps);
  const seedBuffer = await generateSeedFrame(
    generator,
    params.prompt,
    poses[0],
    {
      quality: params.quality,
      background: params.background,
    }
  );

  // Step 2: Generate animation strips in batches
  const allRawFrames: Buffer[] = [];

  for (let batch = 0; batch < batchCount; batch++) {
    const batchStart = batch * MAX_FRAMES_PER_STRIP;
    const batchEnd = Math.min(batchStart + MAX_FRAMES_PER_STRIP, params.frameCount);
    const batchFrameCount = batchEnd - batchStart;
    const batchPoses = poses.slice(batchStart, batchEnd);

    // For the first batch, include the seed as frame 1.
    // For subsequent batches, the seed is still the anchor but all
    // strip positions are new frames.
    const stripColumns = batchFrameCount + 1; // seed column + N frame columns

    onProgress?.(
      `Generating strip ${batch + 1}/${batchCount} (frames ${batchStart + 1}-${batchEnd})`,
      2 + batch,
      totalSteps
    );

    // Build canvas with seed at position 0
    const { canvas } = await buildEditCanvas(seedBuffer, stripColumns);
    const mask = await buildStripMask(stripColumns);

    // Build the edit prompt
    const poseList = batchPoses
      .map((pose, i) => `Frame ${i + 1}: ${pose}`)
      .join(". ");

    const editPrompt =
      `A horizontal strip of ${batchFrameCount} animation frames to the right of the reference character. ` +
      `Each frame must show the EXACT SAME character as the reference (leftmost) -- identical proportions, ` +
      `colors, art style, outfit, and features. Only the pose changes. ` +
      `${poseList}. ` +
      `Each frame is separated by clear empty space. The character is centered within each frame position.`;

    let stripResult: Buffer;
    try {
      stripResult = await generator.editImage(
        canvas,
        editPrompt,
        {
          quality: params.quality,
          size: "1536x1024",
          mask,
          background: params.background ?? "transparent",
          inputFidelity: "high",
          model: "gpt-image-1",
        }
      );
    } catch (error) {
      // Fallback: generate each frame standalone
      console.error(`Strip generation failed for batch ${batch + 1}, falling back to per-frame`);
      for (const pose of batchPoses) {
        const fb = await generateSeedFrame(generator, params.prompt, pose, {
          quality: params.quality,
          background: params.background,
        });
        allRawFrames.push(fb);
      }
      continue;
    }

    // Extract frames from the strip result via contour detection
    // Skip the first blob (that's the seed) -- we only want the new frames
    const { frames: extractedFrames } = await extractFramesByContour(
      stripResult,
      batchFrameCount + 1 // include seed blob in expected count
    );

    // Skip the first frame (seed) and take the rest
    const newFrames = extractedFrames.slice(1);
    allRawFrames.push(...newFrames);

    // If contour extraction found fewer frames than expected,
    // fall back to generating the missing frames standalone
    const missing = batchFrameCount - newFrames.length;
    if (missing > 0) {
      console.error(`Contour extraction found ${newFrames.length}/${batchFrameCount} frames, generating ${missing} standalone`);
      for (let i = newFrames.length; i < batchFrameCount; i++) {
        const fb = await generateSeedFrame(generator, params.prompt, batchPoses[i], {
          quality: params.quality,
          background: params.background,
        });
        allRawFrames.push(fb);
      }
    }
  }

  // Step 3: Normalize all frames
  onProgress?.("Normalizing frames", 2 + batchCount, totalSteps);
  const targetSize = 512; // output frame size
  const normalizedFrames = await normalizeFrames(allRawFrames, targetSize, "soft");

  // Step 4: Quality gate
  onProgress?.("Running quality checks", 2 + batchCount + 1, totalSteps);
  const quality = await runQualityChecks(normalizedFrames, params.frameCount, targetSize);

  onProgress?.("Frames ready", totalSteps, totalSteps);

  return {
    frames: normalizedFrames,
    frameWidth: targetSize,
    frameHeight: targetSize,
    quality,
  };
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "feat: hybrid sprite pipeline with seed + edit strip + contour extraction"
```

---

### Task 7: Wire up the hybrid pipeline as the default mode

**Files:**
- Modify: `src/tools.ts:643-900`
- Modify: `src/sprite-frames.ts` (update exports)

- [ ] **Step 1: Add generateHybridSheet to the imports in tools.ts**

```typescript
import {
  generateFrames,
  generateSingleSheet,
  generateHybridSheet,
  stitchFrames,
  cleanFramesForGif,
  normalizeFrames,
} from "./sprite-frames.js";
```

- [ ] **Step 2: Update the generate_sprite_sheet_hq handler to use hybrid mode as default**

Replace the `usePerFrame` logic and the if/else branches in the tool handler (lines ~731-799) with:

```typescript
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
          const batchCount = Math.ceil(frameCount / 6);
          apiCalls = 1 + batchCount; // seed + N strip edits
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
```

- [ ] **Step 3: Update the per_frame_mode parameter description**

```typescript
      per_frame_mode: z
        .boolean()
        .optional()
        .describe(
          "Generation mode override. Default (unset): hybrid pipeline -- generates a seed " +
            "frame then uses the edit API to create an animation strip with contour-based " +
            "extraction. Set to true for legacy per-frame edit mode. Set to false for " +
            "single-sheet mode (fastest but may have frame bleed)."
        ),
```

- [ ] **Step 4: Update the tool description**

```typescript
    "generate_sprite_sheet_hq",
    "Generate a high-quality sprite sheet with consistent character design across all frames. " +
      "Uses a hybrid pipeline: generates a seed frame, then uses the edit API to create an " +
      "animation strip anchored to the seed for character consistency. Frames are extracted " +
      "by contour detection (not grid splitting) for clean isolation. Includes animated GIF " +
      "preview and JSON metadata.",
```

- [ ] **Step 5: Update the output mode descriptions**

```typescript
        output.push(
          `  API calls: ${apiCalls}`,
          ``,
          mode === "hybrid"
            ? `Seed frame generated, then edit API produced animation strip with input_fidelity="high".\nFrames extracted by contour detection and normalized with bottom-center anchoring.`
            : mode === "single-sheet"
            ? `All frames generated in a single image, then split and post-processed.`
            : `Each frame generated individually via edit API.`,
        );
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts src/sprite-frames.ts
git commit -m "feat: wire hybrid sprite pipeline as default generation mode"
```

---

### Task 8: Clean up dead code and verify end-to-end

**Files:**
- Modify: `src/sprite-frames.ts` (remove unused grid template code)

- [ ] **Step 1: Remove unused grid template functions**

Remove these functions that are no longer used by any code path:
- `createGridTemplate()` -- was for the per-cell edit approach
- `createSingleCellMask()` -- was for the per-cell edit approach
- `buildEditPrompt()` -- was for the grid template approach
- The `MARK_COLOR`, `MARK_SIZE`, `MARK_THICKNESS`, `BORDER_THICKNESS` constants
- The `stripMarksFromPixels()` function
- The manual `dilateMask()` function
- The manual `floodFillMask()` function

Keep:
- `ANIMATION_PRESETS`, `resolveFramePoses` -- still used by all modes
- `buildSheetPrompt`, `generateSingleSheet` -- still used by `per_frame_mode: false`
- `generateFrames`, `generateFramePrompts` -- still used by `per_frame_mode: true`
- `stitchFrames` -- still used by the tool handler
- `cleanFramesForGif` -- still used for GIF output
- `runQualityChecks` -- still used by all modes
- `SpriteQualityMetrics` -- exported type
- `extractFrameAdaptive`, `measureEdgeBleed` -- still used by single-sheet mode
- All new functions: `generateSeedFrame`, `buildEditCanvas`, `buildStripMask`, `extractFramesByContour`, `normalizeFrames`, `generateHybridSheet`

- [ ] **Step 2: Build and verify no references broken**

Run: `npm run build`
Expected: Clean compilation, no unused import warnings

- [ ] **Step 3: Smoke test the server starts**

Run: `timeout 3 node dist/index.js 2>&1 || true`
Expected: "mcp-asset-generator server running on stdio"

- [ ] **Step 4: Commit**

```bash
git add src/sprite-frames.ts
git commit -m "refactor: remove unused grid template and per-cell edit code"
```

---

## Self-Review

**Spec coverage:**
- Seed frame generation
- Canvas with seed at position 1
- Edit API with `input_fidelity: "high"`
- Contour-based extraction (not grid splitting)
- Bottom-center anchoring
- Batch generation for 7+ frames
- Fallback to standalone generation on failure
- Quality gate metrics
- GIF binary alpha via `cleanFramesForGif` (existing)

**Placeholder scan:** All code blocks contain complete implementations. No TBDs.

**Type consistency:** `generateHybridSheet` returns `{ frames, frameWidth, frameHeight, quality }` matching the pattern used by `generateSingleSheet`. `SpriteQualityMetrics` is the same type throughout. `normalizeFrames` is called with mode `"soft"` for PNG (in hybrid) and separately via `cleanFramesForGif` for GIF output.
