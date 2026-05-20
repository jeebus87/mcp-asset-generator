import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateSlug, saveImage, saveSpriteSheetMeta } from "../files.js";

describe("generateSlug", () => {
  it("converts spaces to hyphens", () => {
    expect(generateSlug("a cool logo")).toBe("a-cool-logo");
  });

  it("lowercases everything", () => {
    expect(generateSlug("My AWESOME Banner")).toBe("my-awesome-banner");
  });

  it("strips special characters", () => {
    expect(generateSlug("hello! @world #2024")).toBe("hello-world-2024");
  });

  it("collapses multiple hyphens", () => {
    expect(generateSlug("too   many   spaces")).toBe("too-many-spaces");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    expect(generateSlug(long).length).toBeLessThanOrEqual(60);
  });

  it("strips leading and trailing hyphens", () => {
    expect(generateSlug("  -hello- ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(generateSlug("")).toBe("");
  });
});

describe("saveImage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "save-image-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves a PNG buffer to the correct type subfolder", () => {
    const buffer = Buffer.from("fake-png-data");
    const result = saveImage(buffer, "logo", "my brand logo", tmpDir);

    expect(result).toContain(path.join("logos", "my-brand-logo.png"));
    expect(fs.existsSync(result)).toBe(true);
    expect(fs.readFileSync(result).toString()).toBe("fake-png-data");
  });

  it("creates nested directories for game types", () => {
    const buffer = Buffer.from("sprite-data");
    const result = saveImage(buffer, "game_sprite", "knight hero", tmpDir);

    expect(result).toContain(path.join("game", "sprites"));
    expect(fs.existsSync(result)).toBe(true);
  });

  it("avoids overwriting by appending numeric suffix", () => {
    const buffer1 = Buffer.from("first");
    const buffer2 = Buffer.from("second");

    const path1 = saveImage(buffer1, "icon", "test icon", tmpDir);
    const path2 = saveImage(buffer2, "icon", "test icon", tmpDir);

    expect(path1).not.toBe(path2);
    expect(path2).toContain("test-icon-1.png");
    expect(fs.existsSync(path1)).toBe(true);
    expect(fs.existsSync(path2)).toBe(true);
  });

  it("saves sprite_sheet type to game/sprite-sheets/", () => {
    const buffer = Buffer.from("sheet-data");
    const result = saveImage(buffer, "sprite_sheet", "goblin walk", tmpDir);
    expect(result).toContain(path.join("game", "sprite-sheets"));
  });
});

describe("saveSpriteSheetMeta", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a JSON file next to the image path", () => {
    const imagePath = path.join(tmpDir, "goblin-walk.png");
    fs.writeFileSync(imagePath, "fake");

    const jsonPath = saveSpriteSheetMeta(imagePath, {
      animation: "walk",
      frameWidth: 256,
      frameHeight: 256,
      columns: 4,
      rows: 2,
      frameCount: 8,
      fps: 12,
    });

    expect(jsonPath).toBe(path.join(tmpDir, "goblin-walk.json"));
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it("produces valid TexturePacker-compatible JSON", () => {
    const imagePath = path.join(tmpDir, "sprite.png");
    fs.writeFileSync(imagePath, "fake");

    const jsonPath = saveSpriteSheetMeta(imagePath, {
      animation: "idle",
      frameWidth: 128,
      frameHeight: 128,
      columns: 4,
      rows: 2,
      frameCount: 8,
      fps: 10,
    });

    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    // Check frames
    expect(Object.keys(data.frames)).toHaveLength(8);
    expect(data.frames["idle_0"].frame).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    expect(data.frames["idle_4"].frame).toEqual({ x: 0, y: 128, w: 128, h: 128 });
    expect(data.frames["idle_7"].frame).toEqual({ x: 384, y: 128, w: 128, h: 128 });

    // Check meta
    expect(data.meta.app).toBe("mcp-asset-generator");
    expect(data.meta.image).toBe("sprite.png");
    expect(data.meta.size).toEqual({ w: 512, h: 256 });

    // Check animations
    expect(data.animations.idle).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("frame positions respect column/row layout", () => {
    const imagePath = path.join(tmpDir, "attack.png");
    fs.writeFileSync(imagePath, "fake");

    saveSpriteSheetMeta(imagePath, {
      animation: "attack",
      frameWidth: 64,
      frameHeight: 64,
      columns: 3,
      rows: 2,
      frameCount: 5,
      fps: 8,
    });

    const data = JSON.parse(
      fs.readFileSync(imagePath.replace(".png", ".json"), "utf-8")
    );

    // Frame 0: col 0, row 0
    expect(data.frames["attack_0"].frame).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    // Frame 2: col 2, row 0
    expect(data.frames["attack_2"].frame).toEqual({ x: 128, y: 0, w: 64, h: 64 });
    // Frame 3: col 0, row 1
    expect(data.frames["attack_3"].frame).toEqual({ x: 0, y: 64, w: 64, h: 64 });
    // Frame 4: col 1, row 1
    expect(data.frames["attack_4"].frame).toEqual({ x: 64, y: 64, w: 64, h: 64 });
  });
});
