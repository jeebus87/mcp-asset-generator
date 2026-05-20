import sharp from "sharp";
// @ts-expect-error gifenc has no type declarations
import { GIFEncoder, quantize, applyPalette } from "gifenc";

/**
 * Create an animated GIF from an array of frame buffers (PNG/raw image data).
 * Uses gifenc for palette quantization and GIF encoding.
 */
export async function createAnimatedGif(
  frameBuffers: Buffer[],
  frameWidth: number,
  frameHeight: number,
  fps: number
): Promise<Buffer> {
  const delay = Math.round(1000 / fps);
  const encoder = GIFEncoder();

  for (const frameBuf of frameBuffers) {
    // Convert each frame to raw RGBA pixels at exact target size
    const { data } = await sharp(frameBuf)
      .resize(frameWidth, frameHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Quantize to 256-color palette (GIF requirement)
    const palette = quantize(data, 256, { format: "rgba4444" });
    const indexed = applyPalette(data, palette, "rgba4444");

    encoder.writeFrame(indexed, frameWidth, frameHeight, {
      palette,
      delay,
      transparent: true,
      dispose: 2, // restore to background between frames
    });
  }

  encoder.finish();
  return Buffer.from(encoder.bytes());
}
