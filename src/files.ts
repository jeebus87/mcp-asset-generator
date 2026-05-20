import * as fs from "node:fs";
import * as path from "node:path";
import { AssetType } from "./types.js";

const TYPE_FOLDERS: Record<AssetType, string> = {
  logo: "logos",
  icon: "icons",
  og_image: "og-images",
  banner: "banners",
  favicon: "favicons",
  illustration: "illustrations",
  newsletter_banner: "newsletter-banners",
  game_sprite: "game/sprites",
  game_icon: "game/icons",
  game_character: "game/characters",
  game_background: "game/backgrounds",
  game_ui: "game/ui",
  print_newsletter: "newsletters",
  sprite_sheet: "game/sprite-sheets",
  general: "general",
};

export function generateSlug(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

export function saveImage(
  buffer: Buffer,
  assetType: AssetType,
  prompt: string,
  baseDir: string
): string {
  const folder = TYPE_FOLDERS[assetType];
  const dir = path.join(baseDir, folder);
  fs.mkdirSync(dir, { recursive: true });

  const slug = generateSlug(prompt);
  let filename = `${slug}.png`;
  let filePath = path.join(dir, filename);

  // Avoid overwriting: append numeric suffix if file exists
  let counter = 1;
  while (fs.existsSync(filePath)) {
    filename = `${slug}-${counter}.png`;
    filePath = path.join(dir, filename);
    counter++;
  }

  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export interface SpriteSheetMeta {
  animation: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  fps: number;
}

export function saveSpriteSheetMeta(
  imagePath: string,
  meta: SpriteSheetMeta
): string {
  const jsonPath = imagePath.replace(/\.png$/, ".json");

  const frames: Record<string, unknown> = {};
  for (let i = 0; i < meta.frameCount; i++) {
    const col = i % meta.columns;
    const row = Math.floor(i / meta.columns);
    frames[`${meta.animation}_${i}`] = {
      frame: {
        x: col * meta.frameWidth,
        y: row * meta.frameHeight,
        w: meta.frameWidth,
        h: meta.frameHeight,
      },
      rotated: false,
      trimmed: false,
      spriteSourceSize: {
        x: 0,
        y: 0,
        w: meta.frameWidth,
        h: meta.frameHeight,
      },
      sourceSize: { w: meta.frameWidth, h: meta.frameHeight },
    };
  }

  const output = {
    frames,
    meta: {
      app: "mcp-asset-generator",
      version: "1.0",
      image: path.basename(imagePath),
      format: "RGBA8888",
      size: {
        w: meta.columns * meta.frameWidth,
        h: meta.rows * meta.frameHeight,
      },
      scale: 1,
    },
    animations: {
      [meta.animation]: Array.from({ length: meta.frameCount }, (_, i) => i),
    },
  };

  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  return jsonPath;
}
