import { describe, it, expect, vi } from "vitest";
import {
  generateFramePrompts,
  buildSheetPrompt,
  stitchFrames,
  generateFrames,
  generateSingleSheet,
  type SpriteSheetParams,
} from "../sprite-frames.js";

describe("generateFramePrompts", () => {
  const base = "a pixel-art goblin with green skin";

  describe("with preset animations", () => {
    it("generates correct number of prompts for walk animation", () => {
      const { generate, edits } = generateFramePrompts(base, "walk", 8);
      expect(edits).toHaveLength(7); // 7 edit prompts + 1 generate = 8 total
    });

    it("generates correct number of prompts for idle animation", () => {
      const { generate, edits } = generateFramePrompts(base, "idle", 4);
      expect(edits).toHaveLength(3);
    });

    it("generate prompt includes base description and style anchor", () => {
      const { generate } = generateFramePrompts(base, "walk", 8);
      expect(generate).toContain(base);
      expect(generate).toContain("consistent lighting");
      expect(generate).toContain("same character");
    });

    it("edit prompts use Change/Preserve format", () => {
      const { edits } = generateFramePrompts(base, "walk", 8);
      for (const prompt of edits) {
        expect(prompt).toContain("Change:");
        expect(prompt).toContain("Preserve:");
        expect(prompt).toContain("Do not change");
      }
    });

    it("edit prompts include base description in Preserve section", () => {
      const { edits } = generateFramePrompts(base, "walk", 4);
      for (const prompt of edits) {
        expect(prompt).toContain(base);
      }
    });

    it("each edit has a distinct pose description", () => {
      const { edits } = generateFramePrompts(base, "attack", 4);
      const unique = new Set(edits);
      expect(unique.size).toBe(3);
    });

    it("cycles preset poses when frameCount exceeds preset length", () => {
      const { generate, edits } = generateFramePrompts(base, "idle", 12);
      expect(edits).toHaveLength(11);
      expect(generate).toContain("standing still, neutral pose");
      expect(edits[7]).toContain("standing still, neutral pose");
    });

    it("handles fewer frames than preset length", () => {
      const { generate, edits } = generateFramePrompts(base, "walk", 3);
      expect(edits).toHaveLength(2);
    });

    it("is case-insensitive for animation names", () => {
      const lower = generateFramePrompts(base, "walk", 4);
      const upper = generateFramePrompts(base, "WALK", 4);
      expect(lower.generate).toContain("walking");
      expect(upper.generate).toContain("walking");
    });
  });

  describe("with custom frame descriptions", () => {
    it("uses custom descriptions when provided", () => {
      const custom = ["crouching low", "leaping up", "mid-air spin", "landing"];
      const { generate, edits } = generateFramePrompts(base, "custom", 4, custom);
      expect(generate).toContain("crouching low");
      expect(edits[0]).toContain("leaping up");
      expect(edits[1]).toContain("mid-air spin");
      expect(edits[2]).toContain("landing");
    });

    it("truncates custom descriptions to frameCount", () => {
      const custom = ["pose1", "pose2", "pose3", "pose4", "pose5"];
      const { generate, edits } = generateFramePrompts(base, "custom", 3, custom);
      expect(edits).toHaveLength(2);
    });

    it("falls back to generic when custom descriptions are too few", () => {
      const custom = ["only-one"];
      const { generate, edits } = generateFramePrompts(base, "dance", 4, custom);
      expect(edits).toHaveLength(3);
      for (const prompt of edits) {
        expect(prompt).toContain("dance");
      }
    });
  });

  describe("with unknown animation (no preset, no custom)", () => {
    it("generates generic pose variations", () => {
      const { generate, edits } = generateFramePrompts(base, "backflip", 4);
      expect(edits).toHaveLength(3);
      expect(generate).toContain(base);
      expect(generate).toContain("backflip");
      for (const prompt of edits) {
        expect(prompt).toContain("backflip");
      }
    });
  });

  describe("edit prompt structure", () => {
    it("does not include 'sprite sheet' language in edit prompts", () => {
      const { edits } = generateFramePrompts(base, "walk", 8);
      for (const prompt of edits) {
        expect(prompt).not.toContain("sprite sheet");
      }
    });

    it("does not include 'frame X of Y' in edit prompts", () => {
      const { edits } = generateFramePrompts(base, "walk", 8);
      for (const prompt of edits) {
        expect(prompt).not.toMatch(/frame \d+ of \d+/);
      }
    });

    it("includes preservation constraints in every edit", () => {
      const { edits } = generateFramePrompts(base, "run", 6);
      for (const prompt of edits) {
        expect(prompt).toContain("Do not change the character's face");
        expect(prompt).toContain("consistent lighting");
      }
    });
  });

  describe("edge cases", () => {
    it("handles frameCount of 2 (minimum)", () => {
      const { generate, edits } = generateFramePrompts(base, "idle", 2);
      expect(edits).toHaveLength(1);
    });

    it("handles frameCount of 16 (maximum)", () => {
      const { generate, edits } = generateFramePrompts(base, "walk", 16);
      expect(edits).toHaveLength(15);
    });

    it("all edit prompts are unique strings", () => {
      const { edits } = generateFramePrompts(base, "walk", 8);
      const unique = new Set(edits);
      expect(unique.size).toBe(7);
    });

    it("empty base description still produces valid prompts", () => {
      const { generate, edits } = generateFramePrompts("", "idle", 4);
      expect(generate.length).toBeGreaterThan(0);
      for (const p of edits) {
        expect(p.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("buildSheetPrompt", () => {
  const base = "a pixel-art goblin with green skin";

  it("includes character description and animation type", () => {
    const prompt = buildSheetPrompt(base, "walk", 8, 4);
    expect(prompt).toContain(base);
    expect(prompt).toContain("walk");
  });

  it("specifies grid layout", () => {
    const prompt = buildSheetPrompt(base, "walk", 8, 4);
    expect(prompt).toContain("4x2 grid");
    expect(prompt).toContain("8 frames");
  });

  it("uses horizontal row for single-row layouts", () => {
    const prompt = buildSheetPrompt(base, "walk", 4, 4);
    expect(prompt).toContain("single horizontal row");
  });

  it("includes per-frame pose descriptions", () => {
    const prompt = buildSheetPrompt(base, "walk", 4, 4);
    expect(prompt).toContain("Frame 1:");
    expect(prompt).toContain("Frame 4:");
    expect(prompt).toContain("walking");
  });

  it("includes consistency instructions", () => {
    const prompt = buildSheetPrompt(base, "idle", 4, 4);
    expect(prompt).toContain("identical proportions");
    expect(prompt).toContain("identical colors");
    expect(prompt).toContain("identical art style");
  });

  it("uses custom descriptions when provided", () => {
    const custom = ["crouching", "jumping", "landing", "standing"];
    const prompt = buildSheetPrompt(base, "custom", 4, 4, custom);
    expect(prompt).toContain("crouching");
    expect(prompt).toContain("landing");
  });
});

describe("stitchFrames", () => {
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
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.format).toBe("png");
  });

  it("produces correct dimensions for 8 frames in 4x2 grid", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeColorBuffer(i * 30, 100, 200))
    );

    const result = await stitchFrames(frames, 4, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(128);
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
    expect(meta.width).toBe(384);
    expect(meta.height).toBe(64);
  });

  it("handles fewer frames than columns (partial last row)", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0),
      makeColorBuffer(0, 255, 0),
      makeColorBuffer(0, 0, 255),
    ]);

    const result = await stitchFrames(frames, 4, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(64);
  });

  it("produces a valid PNG with alpha channel", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0),
      makeColorBuffer(0, 255, 0),
    ]);

    const result = await stitchFrames(frames, 2, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.channels).toBe(4);
  });

  it("resizes frames that don't match target dimensions", async () => {
    const { default: sharp } = await import("sharp");
    const frames = await Promise.all([
      makeColorBuffer(255, 0, 0, 32, 32),
      makeColorBuffer(0, 255, 0, 32, 32),
    ]);

    const result = await stitchFrames(frames, 2, 64, 64);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(64);
  });
});

describe("generateFrames (per-frame edit mode)", () => {
  it("calls generate once and edit for remaining frames", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprite-test-"));

    const { default: sharp } = await import("sharp");
    const fakePng = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
    }).png().toBuffer();

    const mockGenerator = {
      generate: vi.fn(async (params: any) => {
        const filePath = path.join(tmpDir, `frame.png`);
        fs.writeFileSync(filePath, fakePng);
        return {
          filePath, width: 1024, height: 1024, model: "gpt-image-1",
          quality: "high", enhancedPrompt: params.prompt,
          originalPrompt: params.prompt, type: "game_sprite",
          generationParams: {},
        };
      }),
      editImage: vi.fn(async () => fakePng),
    } as any;

    const progressCalls: [string, number, number][] = [];

    const buffers = await generateFrames(
      mockGenerator,
      { prompt: "a test goblin", animation: "idle", frameCount: 3, columns: 4 },
      (step, progress, total) => { progressCalls.push([step, progress, total]); }
    );

    expect(mockGenerator.generate).toHaveBeenCalledTimes(1);
    expect(mockGenerator.editImage).toHaveBeenCalledTimes(2);
    expect(buffers).toHaveLength(3);
    for (const buf of buffers) {
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    }

    // No mask by default
    for (const call of mockGenerator.editImage.mock.calls) {
      const opts = call[2];
      expect(opts.mask).toBeUndefined();
    }

    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[0][0]).toContain("base frame");
    expect(progressCalls[2][0]).toContain("frame 3/3");

    const remaining = fs.readdirSync(tmpDir);
    expect(remaining).toHaveLength(0);
    fs.rmdirSync(tmpDir);
  });

  it("edit prompts use Change/Preserve format", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprite-prompt-"));

    const { default: sharp } = await import("sharp");
    const fakePng = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
    }).png().toBuffer();

    const mockGenerator = {
      generate: vi.fn(async (params: any) => {
        const filePath = path.join(tmpDir, `frame.png`);
        fs.writeFileSync(filePath, fakePng);
        return {
          filePath, width: 1024, height: 1024, model: "gpt-image-1",
          quality: "high", enhancedPrompt: params.prompt,
          originalPrompt: params.prompt, type: "game_sprite",
          generationParams: {},
        };
      }),
      editImage: vi.fn(async () => fakePng),
    } as any;

    await generateFrames(
      mockGenerator,
      { prompt: "a knight in silver armor", animation: "walk", frameCount: 3, columns: 4 },
    );

    for (const call of mockGenerator.editImage.mock.calls) {
      const prompt = call[1];
      expect(prompt).toContain("Change:");
      expect(prompt).toContain("Preserve:");
      expect(prompt).toContain("Do not change");
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("propagates generator errors on frame 1", async () => {
    const mockGenerator = {
      generate: vi.fn(async () => {
        throw new Error("API rate limit exceeded");
      }),
      editImage: vi.fn(),
    } as any;

    await expect(
      generateFrames(mockGenerator, {
        prompt: "a test sprite", animation: "walk", frameCount: 4, columns: 4,
      })
    ).rejects.toThrow("API rate limit exceeded");

    expect(mockGenerator.generate).toHaveBeenCalledTimes(1);
    expect(mockGenerator.editImage).not.toHaveBeenCalled();
  });
});

describe("generateSingleSheet", () => {
  it("generates one image and splits into frames", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { default: sharp } = await import("sharp");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-test-"));

    // Create a fake 1536x1024 image (simulating a 4x2 grid of 384x512 cells)
    const fakeSheet = await sharp({
      create: { width: 1536, height: 1024, channels: 4, background: { r: 100, g: 200, b: 50, alpha: 255 } },
    }).png().toBuffer();

    const mockGenerator = {
      generate: vi.fn(async (params: any) => {
        const filePath = path.join(tmpDir, `sheet.png`);
        fs.writeFileSync(filePath, fakeSheet);
        return {
          filePath, width: 1536, height: 1024, model: "gpt-image-1",
          quality: "high", enhancedPrompt: params.prompt,
          originalPrompt: params.prompt, type: "sprite_sheet",
          generationParams: {},
        };
      }),
    } as any;

    const progressCalls: [string, number, number][] = [];

    const result = await generateSingleSheet(
      mockGenerator,
      { prompt: "a goblin", animation: "walk", frameCount: 8, columns: 4 },
      (step, progress, total) => { progressCalls.push([step, progress, total]); }
    );

    // Should produce 8 frames from one API call
    expect(mockGenerator.generate).toHaveBeenCalledTimes(1);
    expect(result.frames).toHaveLength(8);
    expect(result.frameWidth).toBeGreaterThan(0);
    expect(result.frameHeight).toBeGreaterThan(0);

    for (const frame of result.frames) {
      expect(frame).toBeInstanceOf(Buffer);
      expect(frame.length).toBeGreaterThan(0);
    }

    // Should report progress
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    expect(progressCalls[0][0]).toContain("Generating sprite sheet");
    expect(progressCalls[1][0]).toContain("Splitting");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("generate prompt includes all frame descriptions", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { default: sharp } = await import("sharp");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-prompt-"));

    const fakeSheet = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 100, g: 200, b: 50, alpha: 255 } },
    }).png().toBuffer();

    const mockGenerator = {
      generate: vi.fn(async (params: any) => {
        const filePath = path.join(tmpDir, `sheet.png`);
        fs.writeFileSync(filePath, fakeSheet);
        return {
          filePath, width: 1024, height: 1024, model: "gpt-image-1",
          quality: "high", enhancedPrompt: params.prompt,
          originalPrompt: params.prompt, type: "sprite_sheet",
          generationParams: {},
        };
      }),
    } as any;

    await generateSingleSheet(
      mockGenerator,
      { prompt: "a goblin warrior", animation: "walk", frameCount: 4, columns: 4 },
    );

    const prompt = mockGenerator.generate.mock.calls[0][0].prompt;
    expect(prompt).toContain("a goblin warrior");
    expect(prompt).toContain("walk");
    expect(prompt).toContain("Frame 1:");
    expect(prompt).toContain("Frame 4:");
    expect(prompt).toContain("identical proportions");
  });

  it("propagates errors from the generator", async () => {
    const mockGenerator = {
      generate: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    } as any;

    await expect(
      generateSingleSheet(mockGenerator, {
        prompt: "test", animation: "idle", frameCount: 4, columns: 4,
      })
    ).rejects.toThrow("quota exceeded");
  });
});
