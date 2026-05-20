/**
 * Generate all README example assets via OpenAI gpt-image-2.
 * Run: npx tsx scripts/generate-examples.ts
 * Requires OPENAI_API_KEY in .env
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Load .env from project root
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ExampleAsset {
  outPath: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  background?: "transparent" | "auto";
  quality?: "low" | "medium" | "high";
}

const EXAMPLES: ExampleAsset[] = [
  // App assets
  {
    outPath: "examples/app/logo-cloudsync.png",
    prompt: "flat vector style, minimal design, clean lines, professional brand identity, centered composition, simple shapes, transparent background, no background, isolated on transparency. A cloud with a circular sync arrow forming the logo for CloudSync, a file syncing service. Blue and white color palette, modern SaaS aesthetic.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/app/icon-camera.png",
    prompt: "app icon style, simple recognizable symbol, bold shapes, minimal detail, works at small sizes, centered single element, clean edges, transparent background. A camera icon for a photo editing app, clean geometric shapes, subtle gradient from purple to pink.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/app/favicon-star.png",
    prompt: "extremely simple iconic symbol, maximum 2 colors, recognizable at 16x16 pixels, no text, no fine details, bold single shape, transparent background. A five-pointed star favicon, bright gold color, solid fill, no outline.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/app/banner-fitness.png",
    prompt: "hero image style, wide cinematic composition, high contrast, dramatic lighting, professional photography feel, bold and impactful, wide landscape aspect ratio composition. A fitness app hero banner with a runner silhouette against a sunrise gradient, orange to deep purple, motivational and energetic feeling.",
    size: "1536x1024",
  },
  {
    outPath: "examples/app/og-image-ai-writer.png",
    prompt: "bold headline composition, wide format, high contrast, attention-grabbing, social media optimized, clear focal point, vibrant colors, professional, wide landscape aspect ratio composition. An Open Graph social share image for an AI writing assistant product, abstract neural network patterns in deep blue and electric cyan, modern tech aesthetic, clean and professional.",
    size: "1536x1024",
  },
  // Game assets
  {
    outPath: "examples/game/sprite-knight.png",
    prompt: "game sprite asset, clean outlined character, consistent lighting from top-left, no drop shadow, suitable for 2D game engine, centered on canvas with padding, crisp edges, game-ready art style, transparent background. A pixel-art knight character with sword and shield, silver armor with blue cape, side-facing idle pose.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/game/icon-health-potion.png",
    prompt: "game item icon, bold outlined style, vibrant colors, readable at small sizes, slight 3D depth with highlights, RPG game inventory style, centered single object, clean edges, no background clutter, transparent background. A glowing red health potion in a round glass bottle with a cork stopper, magical shimmer effect.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/game/ui-inventory-frame.png",
    prompt: "game UI element, clean stylized design, consistent border style, suitable for game interface, works on any background, polished and readable, fantasy style, transparent background. An ornate golden frame for a fantasy game inventory slot, decorative corners, subtle inner glow, square shape.",
    size: "1024x1024",
    background: "transparent",
  },
  {
    outPath: "examples/game/character-cyberpunk.png",
    prompt: "game character concept art, full body portrait, dynamic pose, detailed design, consistent art style suitable for game production, clean silhouette, character design sheet feel, professional game art quality, tall portrait aspect ratio, transparent background. A cyberpunk hacker with a neon visor, long dark coat, glowing circuit tattoos on arms, confident stance, neon pink and cyan color accents.",
    size: "1024x1536",
    background: "transparent",
  },
  {
    outPath: "examples/game/background-enchanted-forest.png",
    prompt: "game environment background, rich detail, atmospheric depth with foreground midground background layers, painterly game art style, suitable for parallax scrolling, vibrant and immersive scene, wide landscape aspect ratio. An enchanted forest level background with glowing mushrooms, fireflies, ancient trees with twisted roots, soft fog, magical atmosphere, moonlight filtering through canopy.",
    size: "1536x1024",
  },
  {
    outPath: "examples/game/spritesheet-goblin-walk.png",
    prompt: "sprite sheet grid layout, multiple animation frames of the same character arranged in evenly spaced rows and columns on a single image, consistent art style across all frames, each frame shows a different pose of a walking motion, uniform frame size, clean separation between frames, game-ready 2D pixel art, transparent background between frames. A pixel-art goblin warrior with green skin and rusty armor, 8-frame walk cycle arranged in a 4x2 grid, side view, each frame showing a different phase of walking.",
    size: "1024x1024",
    background: "transparent",
  },
  // Newsletter assets
  {
    outPath: "examples/newsletter/banner-dun-launch.png",
    prompt: "email-safe composition, bold text-friendly layout, high contrast, professional, works on white background, clear subject, horizontally balanced, wide landscape aspect ratio. A product launch email banner for a payment collection app called Dun, dark background with emerald green accents, modern fintech aesthetic, abstract geometric patterns suggesting money flow.",
    size: "1536x1024",
  },
  {
    outPath: "examples/newsletter/print-newsletter-dun.png",
    prompt: "abstract background design for a printed page, NO TEXT NO WORDS NO LETTERS NO TYPOGRAPHY ANYWHERE, purely visual elements only, subtle patterns and gradients, branded color accents, professional atmosphere, large open dark areas suitable for text overlay, 8.5x11 portrait proportions. Dark background with emerald green geometric accents, modern fintech aesthetic for a payment collection company, subtle circuit-like patterns.",
    size: "1024x1536",
  },
  {
    outPath: "examples/newsletter/print-newsletter-dun-with-logo.png",
    prompt: "abstract background design for a printed page, NO TEXT NO WORDS NO LETTERS NO TYPOGRAPHY ANYWHERE, purely visual elements only, subtle patterns and gradients, branded color accents, professional atmosphere, large open dark areas suitable for text overlay, 8.5x11 portrait proportions. Dark background with emerald green geometric accents, modern fintech aesthetic, with a large open area at the top for a logo banner, subtle circuit patterns below.",
    size: "1024x1536",
  },
];

async function generateOne(asset: ExampleAsset, index: number, total: number): Promise<void> {
  const fullPath = path.join(PROJECT_ROOT, asset.outPath);

  if (fs.existsSync(fullPath)) {
    console.error(`[${index + 1}/${total}] SKIP (exists): ${asset.outPath}`);
    return;
  }

  console.error(`[${index + 1}/${total}] Generating: ${asset.outPath} ...`);

  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt: asset.prompt,
    n: 1,
    size: asset.size,
    quality: asset.quality ?? "medium",
    background: asset.background ?? "auto",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`No b64_json in response for ${asset.outPath}`);
  }

  const buffer = Buffer.from(b64, "base64");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);

  console.error(`[${index + 1}/${total}] DONE: ${asset.outPath} (${buffer.length} bytes)`);
}

async function main() {
  console.error(`Generating ${EXAMPLES.length} example assets...`);
  console.error(`Using model: gpt-image-1`);
  console.error("");

  for (let i = 0; i < EXAMPLES.length; i++) {
    try {
      await generateOne(EXAMPLES[i], i, EXAMPLES.length);
    } catch (err) {
      console.error(`[${i + 1}/${EXAMPLES.length}] FAILED: ${EXAMPLES[i].outPath}`);
      console.error(`  Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.error("");
  console.error("Done.");
}

main();
