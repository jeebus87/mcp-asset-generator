import sharp from "sharp";
import { ImageGenerator } from "./generator.js";
import { removeBackground } from "./files.js";
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
    "walking, RIGHT leg stretched far forward with foot flat on ground, LEFT leg far behind pushing off with heel raised, wide stride, arms swinging opposite to legs, body leaning forward",
    "walking, RIGHT foot planted ahead, LEFT foot lifting off ground behind, body weight shifting forward over right leg, knees visibly bent",
    "walking, legs passing each other at midpoint, RIGHT leg under body bearing weight, LEFT leg swinging forward with knee high, body upright",
    "walking, LEFT leg now reaching forward with knee extending, RIGHT leg behind starting to push off, arms switching sides mid-swing",
    "walking, LEFT leg stretched far forward with foot flat on ground, RIGHT leg far behind pushing off with heel raised, wide stride, mirror of first pose",
    "walking, LEFT foot planted ahead, RIGHT foot lifting off ground behind, body weight shifting forward over left leg, knees visibly bent",
    "walking, legs passing each other at midpoint, LEFT leg under body bearing weight, RIGHT leg swinging forward with knee high, body upright",
    "walking, RIGHT leg now reaching forward with knee extending, LEFT leg behind starting to push off, arms switching sides mid-swing",
  ],
  run: [
    "running, right foot striking ground, left arm forward, dynamic pose",
    "running, airborne, right leg behind, left leg tucked",
    "running, left foot striking ground, right arm forward",
    "running, airborne, left leg behind, right leg tucked",
    "running, right foot forward, arms pumping",
    "running, flight phase, both feet off ground, leaning forward",
    "running, left foot forward, arms pumping opposite",
    "running, flight phase, maximum stride extension",
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

export interface PerFrameParams {
  prompt: string;
  animation: string;
  frameCount: number;
  frameDescriptions?: string[];
  quality?: QualityTier;
  background?: "transparent" | "opaque";
  outputDir?: string;
}

/**
 * Build per-frame prompts with consistent character base + varying poses.
 */
export function generateFramePrompts(
  baseDescription: string,
  animation: string,
  frameCount: number,
  customDescriptions?: string[]
): string[] {
  if (customDescriptions && customDescriptions.length >= frameCount) {
    // User provided explicit per-frame descriptions
    return customDescriptions.slice(0, frameCount).map(
      (desc) => `${baseDescription}, ${desc}`
    );
  }

  const preset = ANIMATION_PRESETS[animation.toLowerCase()];
  if (preset) {
    return Array.from({ length: frameCount }, (_, i) => {
      const poseIndex = i % preset.length;
      if (i === 0) {
        // Frame 1: generated from scratch, full description
        return `${baseDescription}, ${animation} animation, ${preset[poseIndex]}`;
      }
      // Frames 2+: edited from frame 1, emphasize pose change
      return `Change the pose of this character to: ${preset[poseIndex]}. ` +
        `Keep the same character, same outfit, same art style. ` +
        `ONLY change the body pose, leg positions, and arm positions. ` +
        `The legs and arms MUST be in a clearly different position than the original.`;
    });
  }

  // No preset and no custom descriptions: generate generic frame variation
  return Array.from({ length: frameCount }, (_, i) => {
    if (i === 0) {
      return `${baseDescription}, ${animation} animation, neutral starting pose`;
    }
    return `Change the pose of this character to: phase ${i + 1} of ${frameCount} ` +
      `in a ${animation} motion. Keep the same character, same outfit, same art style. ` +
      `ONLY change the body pose. The legs and arms MUST be in a clearly different position.`;
  });
}

/**
 * Generate each frame via separate API calls.
 * Frame 1 is generated from scratch. Frames 2-N use the edit API with
 * frame 1 as the source image, changing only the pose. This keeps the
 * character visually consistent across all frames.
 */
export async function generateFrames(
  generator: ImageGenerator,
  params: PerFrameParams,
  onProgress?: (step: string, progress: number, total: number) => void
): Promise<Buffer[]> {
  const prompts = generateFramePrompts(
    params.prompt,
    params.animation,
    params.frameCount,
    params.frameDescriptions
  );

  const totalSteps = params.frameCount + 1; // +1 for stitching
  const buffers: Buffer[] = [];

  // Frame 1: generate from scratch
  onProgress?.(
    `Generating base frame (1/${params.frameCount})`,
    1,
    totalSteps
  );

  const result = await generator.generate({
    prompt: prompts[0],
    type: "game_sprite",
    quality: params.quality,
    background: params.background ?? "transparent",
    outputDir: params.outputDir,
  });

  const fs = await import("node:fs");
  const baseFrameBuffer = fs.readFileSync(result.filePath);
  buffers.push(baseFrameBuffer);

  // Clean up the saved file -- only the final stitched sheet matters
  try {
    fs.unlinkSync(result.filePath);
  } catch {
    // Non-critical
  }

  // Frames 2-N: edit frame 1 to change pose while keeping character consistent
  for (let i = 1; i < prompts.length; i++) {
    onProgress?.(
      `Editing frame ${i + 1}/${params.frameCount}`,
      i + 1,
      totalSteps
    );

    let editedBuffer = await generator.editImage(
      baseFrameBuffer,
      prompts[i],
      { quality: params.quality, size: "1024x1024" }
    );

    // Strip background to true alpha (edit API doesn't support transparent param)
    if (params.background === "transparent" || params.background === undefined) {
      editedBuffer = await removeBackground(editedBuffer);
    }
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

  // Resize each frame to exact target size and build composite list
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

  // Create transparent base canvas and composite all frames
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
