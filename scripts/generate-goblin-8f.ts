import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

import { loadConfig } from "../src/config.js";
import { ImageGenerator } from "../src/generator.js";
import { generateFrames, stitchFrames } from "../src/sprite-frames.js";
import { saveSpriteSheetMeta } from "../src/files.js";
import { createAnimatedGif } from "../src/gif.js";

const config = loadConfig();
const generator = new ImageGenerator(config);

const prompt = "a pixel-art goblin warrior with green skin, rusty brown armor, spiked helmet, red scarf, short sword and round wooden shield";
const animation = "walk";
const frameCount = 8;
const columns = 4;
const fps = 10;

console.error("=== 8-Frame HQ Goblin Walk Cycle ===");

const frameBuffers = await generateFrames(
  generator,
  { prompt, animation, frameCount, quality: "medium", background: "transparent" },
  (step, progress, total) => console.error(`  [${progress}/${total}] ${step}`)
);

console.error("\nStitching...");
const fw = 1024, fh = 1024;
const sheet = await stitchFrames(frameBuffers, columns, fw, fh);

const outDir = path.join(ROOT, "examples", "game");
const sheetPath = path.join(outDir, "spritesheet-goblin-walk-hq-8f.png");
fs.writeFileSync(sheetPath, sheet);

const jsonPath = saveSpriteSheetMeta(sheetPath, {
  animation, frameWidth: fw, frameHeight: fh, columns,
  rows: Math.ceil(frameCount / columns), frameCount, fps,
});

const gif = await createAnimatedGif(frameBuffers, fw, fh, fps, {
  size: 256, background: { r: 42, g: 42, b: 42 },
});
const gifPath = sheetPath.replace(".png", ".gif");
fs.writeFileSync(gifPath, gif);

console.error(`Sheet: ${sheetPath}`);
console.error(`JSON: ${jsonPath}`);
console.error(`GIF: ${gifPath} (${(gif.length / 1024).toFixed(0)} KB)`);
console.error("DONE");
