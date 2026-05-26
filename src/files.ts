import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
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

/**
 * Strip background pixels to true transparency using a two-pass approach:
 *
 * Pass 1: Any pixel where R, G, B are all above the light threshold (default 220)
 *         gets alpha set to 0. This catches white, off-white, and light gray backgrounds
 *         that gpt-image-2 renders behind sprites.
 *
 * Pass 2: Snap semi-transparent pixels to fully transparent or fully opaque.
 *         GIF format only supports binary transparency, so antialiased edges with
 *         partial alpha (e.g., alpha=128) look wrong. Pixels below the alpha cutoff
 *         become fully transparent; above become fully opaque.
 */
export async function removeBackground(
  buffer: Buffer,
  lightThreshold: number = 225,
  alphaCutoff: number = 128
): Promise<Buffer> {
  const image = sharp(buffer);
  const { width, height } = await image.metadata();
  if (!width || !height) return buffer;

  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    // Pass 1: light background pixels -> fully transparent
    if (r > lightThreshold && g > lightThreshold && b > lightThreshold) {
      pixels[i + 3] = 0;
      continue;
    }

    // Pass 2: snap semi-transparent pixels to binary
    if (a > 0 && a < 255) {
      pixels[i + 3] = a >= alphaCutoff ? 255 : 0;
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
