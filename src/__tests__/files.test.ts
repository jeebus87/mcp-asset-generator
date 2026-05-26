import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateSlug, saveImage } from "../files.js";

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
});
