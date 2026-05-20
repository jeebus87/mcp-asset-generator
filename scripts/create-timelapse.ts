import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createAnimatedGif } from "../src/gif.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const folder = "C:\\Projects\\JuridionAI\\screenshots\\phase65-timelapse";
const files = fs.readdirSync(folder).filter(f => f.endsWith(".png")).sort();
console.error(`Loading ${files.length} frames from ${folder}`);

const frameBuffers = files.map(f => fs.readFileSync(path.join(folder, f)));
const firstMeta = await sharp(frameBuffers[0]).metadata();
console.error(`Source: ${firstMeta.width}x${firstMeta.height}`);

const outW = 800;
const outH = Math.round(outW * ((firstMeta.height ?? 600) / (firstMeta.width ?? 800)));

const gif = await createAnimatedGif(frameBuffers, firstMeta.width!, firstMeta.height!, 3, {
  width: outW,
  height: outH,
  background: { r: 24, g: 24, b: 27 },
  loop: -1,
  stripBackground: false,
});

const outPath = path.join(ROOT, "examples", "timelapse-phase65.gif");
fs.writeFileSync(outPath, gif);
console.error(`Done: ${outPath} (${(gif.length / 1024).toFixed(0)} KB)`);
