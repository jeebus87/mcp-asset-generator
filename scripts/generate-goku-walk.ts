/**
 * Generate a 4-directional walking sprite sheet for Goku.
 * 4 directions x 4 frames = 16 frames in a 4x4 grid.
 * Row order: down, left, right, up (standard RPG format).
 *
 * Run: npx tsx scripts/generate-goku-walk.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { ImageGenerator } from "../src/generator.js";
import { generateSingleSheet, stitchFrames } from "../src/sprite-frames.js";
import { saveImage, saveSpriteSheetMeta } from "../src/files.js";
import { createAnimatedGif } from "../src/gif.js";
import { loadConfig } from "../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

// 4 frames per direction, 4 directions = 16 frames
const DIRECTIONS = ["down", "left", "right", "up"] as const;

const DIRECTION_POSES: Record<string, string[]> = {
  down: [
    "facing toward the viewer (front view), standing with left foot forward, arms in walking position",
    "facing toward the viewer (front view), weight on left foot, right foot lifting, mid-stride",
    "facing toward the viewer (front view), standing with right foot forward, arms swapped",
    "facing toward the viewer (front view), weight on right foot, left foot lifting, mid-stride",
  ],
  left: [
    "facing left (side view), left foot forward on ground, right arm forward, contact pose",
    "facing left (side view), weight on left foot, right knee rising, passing pose",
    "facing left (side view), right foot forward on ground, left arm forward, mirror contact",
    "facing left (side view), weight on right foot, left knee rising, mirror passing pose",
  ],
  right: [
    "facing right (side view), right foot forward on ground, left arm forward, contact pose",
    "facing right (side view), weight on right foot, left knee rising, passing pose",
    "facing right (side view), left foot forward on ground, right arm forward, mirror contact",
    "facing right (side view), weight on left foot, right knee rising, mirror passing pose",
  ],
  up: [
    "facing away from the viewer (back view), left foot forward, arms in walking position",
    "facing away from the viewer (back view), weight on left foot, right foot lifting, mid-stride",
    "facing away from the viewer (back view), right foot forward, arms swapped",
    "facing away from the viewer (back view), weight on right foot, left foot lifting, mid-stride",
  ],
};

async function main() {
  const config = loadConfig();
  const generator = new ImageGenerator(config);

  const characterDesc =
    "Goku from Dragon Ball Z in his classic orange gi (martial arts uniform) " +
    "with blue undershirt, blue wristbands, blue boots, spiky black hair, " +
    "pixel-art style, 2D RPG character sprite";

  const framesPerDirection = 4;
  const columns = 4;
  const fps = 8;
  const outputDir = path.join(PROJECT_ROOT, "examples", "game");

  console.error("=== Goku 4-Direction Walk Sprite Sheet ===");
  console.error(`Character: ${characterDesc}`);
  console.error(`Directions: ${DIRECTIONS.join(", ")}`);
  console.error(`Frames per direction: ${framesPerDirection}`);
  console.error(`Total frames: ${DIRECTIONS.length * framesPerDirection}`);
  console.error(`Grid: ${columns}x${DIRECTIONS.length} (one row per direction)`);
  console.error("");

  // Generate each direction as a separate single-sheet call
  const allFrames: Buffer[] = [];
  let frameSize = 0;

  for (const dir of DIRECTIONS) {
    console.error(`--- Generating ${dir} direction ---`);

    const result = await generateSingleSheet(
      generator,
      {
        prompt: characterDesc,
        animation: `walk-${dir}`,
        frameCount: framesPerDirection,
        columns: framesPerDirection, // all in one row for generation
        frameDescriptions: DIRECTION_POSES[dir],
        quality: "high",
        background: "transparent",
        outputDir,
      },
      (step, progress, total) => {
        console.error(`  [${progress}/${total}] ${step}`);
      }
    );

    allFrames.push(...result.frames);
    frameSize = result.frameWidth; // should be consistent
    console.error(`  Got ${result.frames.length} frames, size ${result.frameWidth}x${result.frameHeight}`);
    console.error("");
  }

  // Stitch all 16 frames into 4x4 grid (4 columns, 4 rows)
  console.error("Stitching all directions into 4x4 grid...");
  const sheetBuffer = await stitchFrames(allFrames, columns, frameSize, frameSize);

  // Save sprite sheet
  const outPath = path.join(outputDir, "spritesheet-goku-walk-4dir.png");
  fs.writeFileSync(outPath, sheetBuffer);
  console.error(`Saved: ${outPath}`);

  // Save individual frames for inspection
  for (let i = 0; i < allFrames.length; i++) {
    const dir = DIRECTIONS[Math.floor(i / framesPerDirection)];
    const frameNum = i % framesPerDirection;
    const framePath = path.join(outputDir, `goku-${dir}-${frameNum}.png`);
    fs.writeFileSync(framePath, allFrames[i]);
  }
  console.error(`Saved ${allFrames.length} individual frames`);

  // Save metadata
  const rows = DIRECTIONS.length;
  const jsonPath = saveSpriteSheetMeta(outPath, {
    animation: "walk",
    frameWidth: frameSize,
    frameHeight: frameSize,
    columns,
    rows,
    frameCount: allFrames.length,
    fps,
  });
  console.error(`Metadata: ${jsonPath}`);

  // Generate a GIF preview for each direction
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const dirFrames = allFrames.slice(d * framesPerDirection, (d + 1) * framesPerDirection);
    const gifBuffer = await createAnimatedGif(dirFrames, frameSize, frameSize, fps, {
      background: { r: 42, g: 42, b: 42 },
    });
    const gifPath = path.join(outputDir, `goku-walk-${DIRECTIONS[d]}.gif`);
    fs.writeFileSync(gifPath, gifBuffer);
    console.error(`GIF (${DIRECTIONS[d]}): ${gifPath}`);
  }

  // Also create a combined GIF cycling through all directions
  const allGifBuffer = await createAnimatedGif(allFrames, frameSize, frameSize, fps, {
    background: { r: 42, g: 42, b: 42 },
  });
  const allGifPath = path.join(outputDir, "goku-walk-all.gif");
  fs.writeFileSync(allGifPath, allGifBuffer);
  console.error(`GIF (all directions): ${allGifPath}`);

  // Verify
  const { default: sharp } = await import("sharp");
  const meta = await sharp(sheetBuffer).metadata();
  console.error("");
  console.error("=== Result ===");
  console.error(`Sheet: ${meta.width}x${meta.height}`);
  console.error(`Frame size: ${frameSize}x${frameSize}`);
  console.error(`Grid: ${columns}x${rows}`);
  console.error(`Total frames: ${allFrames.length}`);
  console.error("Row layout: down, left, right, up");
  console.error("");
  console.error("Done!");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
