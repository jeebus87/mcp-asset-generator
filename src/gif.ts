import sharp from "sharp";
import { removeBackground } from "./files.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

/**
 * Create an animated GIF from an array of frame buffers (PNG/raw image data).
 * Uses gifenc for palette quantization and GIF encoding.
 *
 * Pre-processes each frame to strip backgrounds and snap alpha to binary
 * (GIF only supports fully transparent or fully opaque pixels).
 */
export interface GifOptions {
  /** GIF preview size (square). Default 256. */
  size?: number;
  /** Background color as {r, g, b}. Default: solid dark gray (#2a2a2a) for contrast. Set to null for transparent. */
  background?: { r: number; g: number; b: number } | null;
  /** Number of times to loop. 0 = infinite (default for sprites). -1 = no loop (play once). */
  loop?: number;
  /** Strip AI-generated background before encoding. Default true for sprites, false for screenshots/timelapse. */
  stripBackground?: boolean;
  /** Output width. If only width OR height is set, aspect ratio is preserved. If neither, uses size (square). */
  width?: number;
  /** Output height. */
  height?: number;
}

export async function createAnimatedGif(
  frameBuffers: Buffer[],
  frameWidth: number,
  frameHeight: number,
  fps: number,
  options?: GifOptions
): Promise<Buffer> {
  const delay = Math.round(1000 / fps);
  const outW = options?.width ?? options?.size ?? 256;
  const outH = options?.height ?? options?.size ?? 256;
  const bg = options?.background === undefined
    ? { r: 42, g: 42, b: 42 }
    : options.background;
  const useTransparency = bg === null;
  const strip = options?.stripBackground ?? true;
  const loop = options?.loop ?? 0; // 0 = infinite
  const encoder = GIFEncoder();

  for (const frameBuf of frameBuffers) {
    let processed = frameBuf;
    if (strip) {
      processed = Buffer.from(await removeBackground(frameBuf));
    }

    const bgColor = useTransparency
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { ...bg!, alpha: 255 };

    let pipeline = sharp(processed)
      .resize(outW, outH, { fit: "contain", background: bgColor });

    if (!useTransparency && bg) {
      pipeline = pipeline.flatten({ background: bg });
    }

    const { data } = await pipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const palette = quantize(data, 256, { format: "rgba4444" });
    const indexed = applyPalette(data, palette, "rgba4444");

    encoder.writeFrame(indexed, outW, outH, {
      palette,
      delay,
      transparent: useTransparency,
      dispose: 1,
    });
  }

  encoder.finish();
  const bytes = encoder.bytes();

  // Patch the loop count in the GIF header.
  // GIF89a NETSCAPE extension: loop=0 means infinite, loop=1 means play once.
  // gifenc always writes loop=0. For non-infinite, we patch the loop bytes.
  if (loop !== 0) {
    const buf = Buffer.from(bytes);
    // Find NETSCAPE2.0 extension: 0x21 0xFF 0x0B "NETSCAPE2.0" 0x03 0x01 [loop_lo] [loop_hi]
    const needle = Buffer.from("NETSCAPE2.0");
    const idx = buf.indexOf(needle);
    if (idx !== -1) {
      const loopOffset = idx + needle.length + 2; // skip 0x03 0x01
      const loopVal = loop === -1 ? 1 : loop; // -1 = play once = loop count 1
      buf.writeUInt16LE(loopVal, loopOffset);
    }
    return buf;
  }

  return Buffer.from(bytes);
}
