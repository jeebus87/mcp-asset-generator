import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateFramePrompts,
  stitchFrames,
  generateFrames,
  type PerFrameParams,
} from "../sprite-frames.js";

describe("generateFramePrompts", () => {
  const base = "a pixel-art goblin with green skin";

  describe("with preset animations", () => {
    it("generates correct number of prompts for walk animation", () => {
      const prompts = generateFramePrompts(base, "walk", 8);
      expect(prompts).toHaveLength(8);
    });

    it("generates correct number of prompts for idle animation", () => {
      const prompts = generateFramePrompts(base, "idle", 4);
      expect(prompts).toHaveLength(4);
    });

    it("every prompt starts with the base description", () => {
      const prompts = generateFramePrompts(base, "walk", 8);
      for (const prompt of prompts) {
        expect(prompt).toMatch(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      }
    });

    it("includes frame number in each prompt", () => {
      const prompts = generateFramePrompts(base, "run", 6);
      for (let i = 0; i < 6; i++) {
        expect(prompts[i]).toContain(`frame ${i + 1} of 6`);
      }
    });

    it("includes animation name in each prompt", () => {
      const prompts = generateFramePrompts(base, "attack", 4);
      for (const prompt of prompts) {
        expect(prompt).toContain("attack");
      }
    });

    it("cycles preset poses when frameCount exceeds preset length", () => {
      const prompts = generateFramePrompts(base, "idle", 12);
      expect(prompts).toHaveLength(12);
      // Frame 9 (index 8) should cycle back to preset index 0
      // Both should contain the same pose description
      expect(prompts[8]).toContain("standing still, neutral pose");
      expect(prompts[0]).toContain("standing still, neutral pose");
    });

    it("handles fewer frames than preset length", () => {
      const prompts = generateFramePrompts(base, "walk", 3);
      expect(prompts).toHaveLength(3);
    });

    it("is case-insensitive for animation names", () => {
      const lower = generateFramePrompts(base, "walk", 4);
      const upper = generateFramePrompts(base, "WALK", 4);
      // Both should use the walk preset (same pose descriptions)
      expect(lower[0]).toContain("walking");
      expect(upper[0]).toContain("walking");
    });
  });

  describe("with custom frame descriptions", () => {
    it("uses custom descriptions when provided", () => {
      const custom = ["crouching low", "leaping up", "mid-air spin", "landing"];
      const prompts = generateFramePrompts(base, "custom", 4, custom);
      expect(prompts[0]).toBe(`${base}, crouching low`);
      expect(prompts[1]).toBe(`${base}, leaping up`);
      expect(prompts[2]).toBe(`${base}, mid-air spin`);
      expect(prompts[3]).toBe(`${base}, landing`);
    });

    it("truncates custom descriptions to frameCount", () => {
      const custom = ["pose1", "pose2", "pose3", "pose4", "pose5"];
      const prompts = generateFramePrompts(base, "custom", 3, custom);
      expect(prompts).toHaveLength(3);
      expect(prompts[2]).toBe(`${base}, pose3`);
    });

    it("falls back to generic when custom descriptions are too few", () => {
      const custom = ["only-one"];
      const prompts = generateFramePrompts(base, "dance", 4, custom);
      // Not enough custom descriptions, falls through to generic
      expect(prompts).toHaveLength(4);
      for (const prompt of prompts) {
        expect(prompt).toContain("dance");
      }
    });
  });

  describe("with unknown animation (no preset, no custom)", () => {
    it("generates generic pose variations", () => {
      const prompts = generateFramePrompts(base, "backflip", 4);
      expect(prompts).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(prompts[i]).toContain(base);
        expect(prompts[i]).toContain("backflip");
        expect(prompts[i]).toContain(`frame ${i + 1} of 4`);
      }
    });
  });

  describe("edge cases", () => {
    it("handles frameCount of 2 (minimum)", () => {
      const prompts = generateFramePrompts(base, "idle", 2);
      expect(prompts).toHaveLength(2);
    });

    it("handles frameCount of 16 (maximum)", () => {
      const prompts = generateFramePrompts(base, "walk", 16);
      expect(prompts).toHaveLength(16);
    });

    it("all prompts are unique strings", () => {
      const prompts = generateFramePrompts(base, "walk", 8);
      const unique = new Set(prompts);
      expect(unique.size).toBe(8);
    });

    it("empty base description still produces valid prompts", () => {
      const prompts = generateFramePrompts("", "idle", 4);
      expect(prompts).toHaveLength(4);
      for (const p of prompts) {
        expect(p.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("stitchFrames", () => {
  // Create small solid-color PNG buffers for testing
  async function makeColorBuffer(
    r: number, g: number, b: number,
    width = 64, height = 64
  ): Promise<Buffer> {
    const { default: sharp } = await import("sharp");
    return sharp({
      create: { width, height, channels: 4, background: { r, g, b, alpha: 255 } },
    }).png().toBuffer();
  }

  it("produces a buffer with correct dimensions for 4 frames in 2x2 grid", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0),
      makeColorBuffer(0, 255, 0),
      makeColorBuffer(0, 0, 255),
      makeColorBuffer(255, 255, 0),
    ]);

    const result = await stitchFrames(frames, 2, 64, 64);
    expect(result).toBeInstanceOf(Buffer);

    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(128);  // 2 columns * 64
    expect(meta.height).toBe(128); // 2 rows * 64
    expect(meta.format).toBe("png");
  });

  it("produces correct dimensions for 8 frames in 4x2 grid", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeColorBuffer(i * 30, 100, 200))
    );

    const result = await stitchFrames(frames, 4, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(256);  // 4 * 64
    expect(meta.height).toBe(128); // 2 * 64
  });

  it("handles non-square frames", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0, 128, 64),
      makeColorBuffer(0, 255, 0, 128, 64),
      makeColorBuffer(0, 0, 255, 128, 64),
    ]);

    const result = await stitchFrames(frames, 3, 128, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(384);  // 3 * 128
    expect(meta.height).toBe(64);  // 1 row * 64
  });

  it("handles fewer frames than columns (partial last row)", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0),
      makeColorBuffer(0, 255, 0),
      makeColorBuffer(0, 0, 255),
    ]);

    // 3 frames, 4 columns = 1 row with empty last cell
    const result = await stitchFrames(frames, 4, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(256);  // 4 * 64
    expect(meta.height).toBe(64);  // ceil(3/4) = 1 row
  });

  it("produces a valid PNG with alpha channel", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0),
      makeColorBuffer(0, 255, 0),
    ]);

    const result = await stitchFrames(frames, 2, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.channels).toBe(4); // RGBA
  });

  it("resizes frames that don't match target dimensions", async () => {
    const { default: sharp } = await import("sharp");
    // Create 32x32 frames but stitch at 64x64 target
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0, 32, 32),
      makeColorBuffer(0, 255, 0, 32, 32),
    ]);

    const result = await stitchFrames(frames, 2, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(128); // 2 * 64
    expect(meta.height).toBe(64); // 1 * 64
  });
});

describe("generateFrames", () => {
  it("calls generator.generate once per frame and returns buffers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    // Create a temp directory for fake generated files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprite-test-"));

    // Create a tiny valid PNG to use as fake output
    const { default: sharp } = await import("sharp");
    const fakePng = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
    }).png().toBuffer();

    let callCount = 0;
    const mockGenerator = {
      generate: vi.fn(async (params: any) => {
        callCount++;
        const filePath = path.join(tmpDir, `frame-${callCount}.png`);
        fs.writeFileSync(filePath, fakePng);
        return {
          filePath,
          width: 1024,
          height: 1024,
          model: "gpt-image-2",
          quality: "high",
          enhancedPrompt: params.prompt,
          originalPrompt: params.prompt,
          type: "game_sprite",
          generationParams: {},
        };
      }),
    } as any;

    const progressCalls: [string, number, number][] = [];

    const buffers = await generateFrames(
      mockGenerator,
      {
        prompt: "a test goblin",
        animation: "idle",
        frameCount: 3,
      },
      (step, progress, total) => {
        progressCalls.push([step, progress, total]);
      }
    );

    // Should have called generate 3 times
    expect(mockGenerator.generate).toHaveBeenCalledTimes(3);

    // Should return 3 buffers
    expect(buffers).toHaveLength(3);
    for (const buf of buffers) {
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    }

    // Progress should have been called for each frame
    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[0][0]).toContain("frame 1/3");
    expect(progressCalls[2][0]).toContain("frame 3/3");

    // Temp frame files should have been cleaned up
    const remaining = fs.readdirSync(tmpDir);
    expect(remaining).toHaveLength(0);

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  it("propagates generator errors with context", async () => {
    const mockGenerator = {
      generate: vi.fn(async () => {
        throw new Error("API rate limit exceeded");
      }),
    } as any;

    await expect(
      generateFrames(mockGenerator, {
        prompt: "a test sprite",
        animation: "walk",
        frameCount: 4,
      })
    ).rejects.toThrow("API rate limit exceeded");

    // Should have only called generate once (fails on first frame)
    expect(mockGenerator.generate).toHaveBeenCalledTimes(1);
  });
});
