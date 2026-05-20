/**
 * Integration test: generate an HQ sprite sheet using per-frame rendering.
 * This exercises the Phase 5 code path end-to-end against the real API.
 *
 * Run: npx tsx scripts/test-hq-spritesheet.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { ImageGenerator } from "../src/generator.js";
import { generateFrames, stitchFrames, generateFramePrompts } from "../src/sprite-frames.js";
import { saveImage, saveSpriteSheetMeta } from "../src/files.js";
import { loadConfig } from "../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

async function main() {
  const config = loadConfig();
  const generator = new ImageGenerator(config);

  const prompt = "a pixel-art goblin warrior with green skin and rusty armor";
  const animation = "walk";
  const frameCount = 4; // 4 frames to keep cost/time reasonable
  const columns = 4;
  const fps = 12;

  console.error("=== HQ Sprite Sheet Integration Test ===");
  console.error(`Prompt: ${prompt}`);
  console.error(`Animation: ${animation}`);
  console.error(`Frames: ${frameCount}`);
  console.error(`API calls: ${frameCount} (one per frame)`);
  console.error("");

  // Step 1: Show the prompts that will be generated
  const prompts = generateFramePrompts(prompt, animation, frameCount);
  console.error("Per-frame prompts:");
  for (let i = 0; i < prompts.length; i++) {
    console.error(`  Frame ${i + 1}: ${prompts[i].slice(0, 100)}...`);
  }
  console.error("");

  // Step 2: Generate each frame individually
  console.error("Generating frames...");
  const startTime = Date.now();

  const frameBuffers = await generateFrames(
    generator,
    {
      prompt,
      animation,
      frameCount,
      quality: "medium",
      background: "transparent",
      outputDir: path.join(PROJECT_ROOT, "examples", "game"),
    },
    (step, progress, total) => {
      console.error(`  [${progress}/${total}] ${step}`);
    }
  );

  const genTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`Frame generation complete in ${genTime}s`);
  console.error(`Buffers received: ${frameBuffers.length}`);
  for (let i = 0; i < frameBuffers.length; i++) {
    console.error(`  Frame ${i + 1}: ${frameBuffers[i].length} bytes`);
  }
  console.error("");

  // Step 3: Stitch into sprite sheet
  console.error("Stitching frames...");
  const frameWidth = 1024;
  const frameHeight = 1024;
  const sheetBuffer = await stitchFrames(frameBuffers, columns, frameWidth, frameHeight);
  console.error(`Sheet buffer: ${sheetBuffer.length} bytes`);

  // Step 4: Save
  // Overwrite the old HQ version with the new edit-based version
  const outPath = path.join(PROJECT_ROOT, "examples", "game", "spritesheet-goblin-walk-hq.png");
  fs.writeFileSync(outPath, sheetBuffer);
  console.error(`Saved: ${outPath}`);

  // Step 5: Generate metadata
  const jsonPath = saveSpriteSheetMeta(outPath, {
    animation,
    frameWidth,
    frameHeight,
    columns,
    rows: Math.ceil(frameCount / columns),
    frameCount,
    fps,
  });
  console.error(`Metadata: ${jsonPath}`);

  // Step 6: Verify output
  const { default: sharp } = await import("sharp");
  const meta = await sharp(sheetBuffer).metadata();
  console.error("");
  console.error("=== Verification ===");
  console.error(`Dimensions: ${meta.width}x${meta.height}`);
  console.error(`Expected:   ${columns * frameWidth}x${Math.ceil(frameCount / columns) * frameHeight}`);
  console.error(`Format: ${meta.format}`);
  console.error(`Channels: ${meta.channels} (4 = RGBA)`);

  const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.error(`JSON frames: ${Object.keys(jsonData.frames).length}`);
  console.error(`JSON animation: ${JSON.stringify(jsonData.animations)}`);

  const pass =
    meta.width === columns * frameWidth &&
    meta.height === Math.ceil(frameCount / columns) * frameHeight &&
    meta.channels === 4 &&
    Object.keys(jsonData.frames).length === frameCount;

  console.error("");
  console.error(pass ? "PASS -- all checks passed" : "FAIL -- see above");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
