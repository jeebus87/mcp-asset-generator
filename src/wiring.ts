import * as fs from "node:fs";
import * as path from "node:path";

export interface IntegrationPoint {
  file: string;
  line: number;
  column: number;
  type: "img_src" | "favicon_link" | "css_background" | "component_import" | "meta_tag";
  currentValue: string;
  lineContent: string;
}

export interface WiringProposal {
  file: string;
  line: number;
  type: IntegrationPoint["type"];
  before: string;
  after: string;
}

// Patterns to find asset references in source code
const SEARCH_PATTERNS: {
  type: IntegrationPoint["type"];
  pattern: RegExp;
  extensions: string[];
}[] = [
  {
    type: "img_src",
    pattern: /(?:src|href)\s*=\s*["']([^"']*(?:logo|icon|banner|favicon|image|img|illustration|hero|og[_-]?image|cover|header)[^"']*)["']/gi,
    extensions: [".tsx", ".jsx", ".html", ".vue", ".svelte", ".astro"],
  },
  {
    type: "img_src",
    pattern: /(?:src|href)\s*=\s*\{[`"']([^`"']*(?:logo|icon|banner|favicon|image|img|illustration|hero|og[_-]?image|cover|header)[^`"']*)[`"']\}/gi,
    extensions: [".tsx", ".jsx"],
  },
  {
    type: "favicon_link",
    pattern: /<link[^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href\s*=\s*["']([^"']*)["'][^>]*>/gi,
    extensions: [".html", ".tsx", ".jsx", ".vue", ".svelte", ".astro"],
  },
  {
    type: "meta_tag",
    pattern: /<meta[^>]*(?:property|name)\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi,
    extensions: [".html", ".tsx", ".jsx", ".vue", ".svelte", ".astro"],
  },
  {
    type: "css_background",
    pattern: /background(?:-image)?\s*:\s*url\(\s*["']?([^"')]*(?:logo|icon|banner|image|illustration|hero|cover|header)[^"')]*)/gi,
    extensions: [".css", ".scss", ".less", ".tsx", ".jsx", ".vue", ".svelte"],
  },
  {
    type: "component_import",
    pattern: /import\s+\w+\s+from\s+["']([^"']*(?:logo|icon|banner|favicon|image|illustration|hero|cover|header)[^"']*)["']/gi,
    extensions: [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"],
  },
];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".output",
  ".planning",
  "assets",
]);

function walkDir(dir: string, extensions: Set<string>): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, extensions));
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

export function findIntegrationPoints(
  searchDir: string,
  assetType?: string
): IntegrationPoint[] {
  const allExtensions = new Set<string>();
  for (const sp of SEARCH_PATTERNS) {
    for (const ext of sp.extensions) {
      allExtensions.add(ext);
    }
  }

  const files = walkDir(searchDir, allExtensions);
  const points: IntegrationPoint[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    for (const searchPattern of SEARCH_PATTERNS) {
      const ext = path.extname(file).toLowerCase();
      if (!searchPattern.extensions.includes(ext)) continue;

      const regex = new RegExp(searchPattern.pattern.source, searchPattern.pattern.flags);

      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNum = beforeMatch.split("\n").length;
        const lineStart = beforeMatch.lastIndexOf("\n") + 1;
        const column = match.index - lineStart;

        const refValue = match[1] || "";

        if (assetType && !isRelevantForType(refValue, searchPattern.type, assetType)) {
          continue;
        }

        points.push({
          file: path.relative(searchDir, file),
          line: lineNum,
          column,
          type: searchPattern.type,
          currentValue: refValue,
          lineContent: lines[lineNum - 1]?.trim() ?? "",
        });
      }
    }
  }

  return points;
}

function isRelevantForType(
  currentValue: string,
  pointType: IntegrationPoint["type"],
  assetType: string
): boolean {
  const lower = currentValue.toLowerCase();
  // Use regex word boundaries to avoid "og" matching inside "logo"
  const typePatterns: Record<string, RegExp[]> = {
    logo: [/\blogo\b/],
    icon: [/\bicon\b/, /\bapp-icon\b/, /\bappicon\b/],
    favicon: [/\bfavicon\b/, /\bicon\b/],
    og_image: [/\bog[-_]?image\b/, /\bsocial\b/, /\bshare\b/, /\bopengraph\b/],
    banner: [/\bbanner\b/, /\bhero\b/, /\bheader\b/, /\bcover\b/],
    illustration: [/\billustrat/],
    newsletter_banner: [/\bnewsletter\b/, /\bemail[-_]?header\b/, /\bemail[-_]?banner\b/],
  };

  if (assetType === "favicon" && pointType === "favicon_link") return true;
  if (assetType === "og_image" && pointType === "meta_tag") return true;

  const patterns = typePatterns[assetType] ?? [];
  return patterns.some((re) => re.test(lower));
}

export function generateDiffPreview(
  points: IntegrationPoint[],
  newAssetPath: string,
  searchDir: string
): WiringProposal[] {
  const proposals: WiringProposal[] = [];

  for (const point of points) {
    const fullPath = path.join(searchDir, point.file);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const line = lines[point.line - 1];
    if (!line) continue;

    const fileDir = path.dirname(fullPath);
    const relativePath = path.relative(fileDir, newAssetPath).replace(/\\/g, "/");

    const newLine = line.replace(point.currentValue, relativePath);
    if (newLine !== line) {
      proposals.push({
        file: point.file,
        line: point.line,
        type: point.type,
        before: line.trim(),
        after: newLine.trim(),
      });
    }
  }

  return proposals;
}

export function applyWiringChanges(
  proposals: WiringProposal[],
  searchDir: string
): { applied: number; errors: string[] } {
  let applied = 0;
  const errors: string[] = [];

  for (const proposal of proposals) {
    const fullPath = path.join(searchDir, proposal.file);
    try {
      let content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const targetLine = lines[proposal.line - 1];

      if (targetLine?.trim() === proposal.before) {
        lines[proposal.line - 1] = targetLine.replace(
          targetLine.trim(),
          proposal.after
        );
        content = lines.join("\n");
        fs.writeFileSync(fullPath, content, "utf-8");
        applied++;
      } else {
        errors.push(
          `${proposal.file}:${proposal.line}: Line changed since scan, skipping`
        );
      }
    } catch (err) {
      errors.push(
        `${proposal.file}:${proposal.line}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { applied, errors };
}
