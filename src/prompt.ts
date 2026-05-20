import { AssetType, ASSET_TYPE_CONFIGS } from "./types.js";

export function enhancePrompt(
  rawPrompt: string,
  assetType: AssetType,
  options?: {
    background?: "transparent" | "opaque" | "auto";
    width?: number;
    height?: number;
  }
): string {
  const config = ASSET_TYPE_CONFIGS[assetType];
  const bg = options?.background ?? config.defaultBackground;

  const parts: string[] = [];

  // Art direction prefix
  parts.push(config.artDirection);

  // Background instruction
  if (bg === "transparent") {
    parts.push("transparent background, no background, isolated on transparency");
  }

  // Aspect ratio hint for non-square
  const w = options?.width ?? config.defaultWidth;
  const h = options?.height ?? config.defaultHeight;
  if (w !== h) {
    const ratio = w > h ? "wide landscape" : "tall portrait";
    parts.push(`${ratio} aspect ratio composition`);
  }

  // User's actual request
  parts.push(rawPrompt);

  // Quality reinforcement
  parts.push("high quality, professional output, production ready");

  return parts.join(". ") + ".";
}

export function inferAssetType(prompt: string): AssetType {
  const lower = prompt.toLowerCase();

  const typePatterns: [AssetType, RegExp][] = [
    ["favicon", /\bfavicon\b/],
    ["logo", /\blog[oo]?\b/],
    // Game types before generic "icon" — "game icon" should match game_icon, not icon
    ["game_sprite", /\bsprite\b|\bgame\s*sprite\b|\bcharacter\s*sprite\b|\benemy\s*sprite\b/],
    ["game_icon", /\bgame\s*icon\b|\binventory\s*icon\b|\bitem\s*icon\b|\bability\s*icon\b|\bpower[\s-]?up\b|\bloot\b|\bspell\s*icon\b/],
    ["game_character", /\bgame\s*character\b|\bcharacter\s*(art|design|concept|portrait)\b|\bplayer\s*character\b|\bnpc\b|\benemy\s*(design|art|concept)\b|\bboss\s*(design|art)\b/],
    ["game_background", /\bgame\s*background\b|\blevel\s*background\b|\bgame\s*scene\b|\bgame\s*environment\b|\bparallax\b|\btileset\b/],
    ["game_ui", /\bgame\s*ui\b|\bgame\s*(button|frame|panel|menu|hud|health\s*bar|interface)\b/],
    ["sprite_sheet", /\bsprite\s*sheet\b|\banimation\s*sheet\b|\bwalk\s*cycle\b|\bidle\s*animation\b|\battack\s*animation\b|\bframe\s*sheet\b/],
    ["print_newsletter", /\bprint(ed)?\s*newsletter\b|\bmail(ed)?\s*newsletter\b|\bphysical\s*newsletter\b|\bprint\s*flyer\b/],
    ["icon", /\bicon\b|\bapp\s*icon\b/],
    ["og_image", /\bog\s*image\b|\bopen\s*graph\b|\bsocial\s*(media\s*)?(\w+\s+)?image\b|\bsocial\s*card\b|\bshare\s*image\b/],
    ["newsletter_banner", /\bnewsletter\b|\bemail\s*header\b|\bemail\s*banner\b/],
    ["banner", /\bbanner\b|\bhero\b|\bheader\s*image\b|\bcover\b/],
    ["illustration", /\billustrat/],
  ];

  for (const [type, pattern] of typePatterns) {
    if (pattern.test(lower)) {
      return type;
    }
  }

  return "general";
}
