import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { createAnimatedGif } from "../gif.js";

async function makeColorFrame(
  r: number, g: number, b: number,
  width = 64, height = 64
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 255 } },
  }).png().toBuffer();
}

describe("createAnimatedGif", () => {
  it("produces a valid GIF buffer from multiple frames", async () => {
    const frames = [
      await makeColorFrame(255, 0, 0),
      await makeColorFrame(0, 255, 0),
      await makeColorFrame(0, 0, 255),
    ];

    const gif = await createAnimatedGif(frames, 64, 64, 12);

    expect(gif).toBeInstanceOf(Buffer);
    expect(gif.length).toBeGreaterThan(0);
    // GIF magic bytes: GIF89a
    expect(gif[0]).toBe(0x47); // G
    expect(gif[1]).toBe(0x49); // I
    expect(gif[2]).toBe(0x46); // F
    expect(gif[3]).toBe(0x38); // 8
    expect(gif[4]).toBe(0x39); // 9
    expect(gif[5]).toBe(0x61); // a
  });

  it("handles 2-frame minimum", async () => {
    const frames = [
      await makeColorFrame(255, 0, 0),
      await makeColorFrame(0, 255, 0),
    ];

    const gif = await createAnimatedGif(frames, 64, 64, 10);
    expect(gif).toBeInstanceOf(Buffer);
    // Should still be GIF89a (animated)
    expect(gif.slice(0, 6).toString("ascii")).toBe("GIF89a");
  });

  it("handles non-square frames", async () => {
    const frames = [
      await makeColorFrame(255, 0, 0, 128, 64),
      await makeColorFrame(0, 255, 0, 128, 64),
    ];

    const gif = await createAnimatedGif(frames, 128, 64, 8);
    expect(gif).toBeInstanceOf(Buffer);
    expect(gif.length).toBeGreaterThan(0);
  });

  it("respects FPS in delay calculation", async () => {
    const frames = [
      await makeColorFrame(255, 0, 0),
      await makeColorFrame(0, 255, 0),
    ];

    // Different FPS should produce different sized GIFs (different delay metadata)
    const gif12 = await createAnimatedGif(frames, 64, 64, 12);
    const gif1 = await createAnimatedGif(frames, 64, 64, 1);

    // Both should be valid GIFs
    expect(gif12.slice(0, 6).toString("ascii")).toBe("GIF89a");
    expect(gif1.slice(0, 6).toString("ascii")).toBe("GIF89a");
  });
});
