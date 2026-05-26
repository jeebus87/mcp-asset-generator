export type AssetType =
  | "logo"
  | "icon"
  | "og_image"
  | "banner"
  | "favicon"
  | "illustration"
  | "newsletter_banner"
  | "game_sprite"
  | "game_icon"
  | "game_character"
  | "game_background"
  | "game_ui"
  | "print_newsletter"
  | "general";

export type QualityTier = "low" | "medium" | "high";

export interface GenerationParams {
  prompt: string;
  type: AssetType;
  width?: number;
  height?: number;
  quality?: QualityTier;
  background?: "transparent" | "opaque" | "auto";
  outputDir?: string;
}

export interface GenerationResult {
  filePath: string;
  width: number;
  height: number;
  model: string;
  quality: QualityTier;
  enhancedPrompt: string;
  originalPrompt: string;
  type: AssetType;
  generationParams: Record<string, unknown>;
}

export interface AssetTypeConfig {
  defaultWidth: number;
  defaultHeight: number;
  defaultBackground: "transparent" | "opaque";
  defaultQuality: QualityTier;
  artDirection: string;
}

export const ASSET_TYPE_CONFIGS: Record<AssetType, AssetTypeConfig> = {
  logo: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "flat vector style, minimal design, clean lines, professional brand identity, centered composition, simple shapes, no gradients unless specified, solid background removal friendly",
  },
  icon: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "app icon style, simple recognizable symbol, bold shapes, minimal detail, works at small sizes, centered single element, clean edges",
  },
  og_image: {
    defaultWidth: 1536,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "bold headline composition, wide format, high contrast, attention-grabbing, social media optimized, clear focal point, vibrant colors, professional",
  },
  banner: {
    defaultWidth: 1536,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "hero image style, wide cinematic composition, high contrast, dramatic lighting, professional photography feel, bold and impactful",
  },
  favicon: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "medium",
    artDirection:
      "extremely simple iconic symbol, maximum 2 colors, recognizable at 16x16 pixels, no text, no fine details, bold single shape",
  },
  illustration: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "modern digital illustration, clean style, consistent with app UI aesthetics, friendly and approachable, balanced composition",
  },
  newsletter_banner: {
    defaultWidth: 1536,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "medium",
    artDirection:
      "email-safe composition, bold text-friendly layout, high contrast, professional, works on white background, clear subject, horizontally balanced",
  },
  game_sprite: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "game sprite asset, clean outlined character or object, consistent lighting from top-left, no drop shadow, suitable for 2D game engine, centered on canvas with padding, crisp edges, game-ready art style",
  },
  game_icon: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "game item icon, bold outlined style, vibrant colors, readable at small sizes, slight 3D depth with highlights, RPG/game inventory style, centered single object, clean edges, no background clutter",
  },
  game_character: {
    defaultWidth: 1024,
    defaultHeight: 1536,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "game character concept art, full body portrait, dynamic pose, detailed design, consistent art style suitable for game production, clean silhouette, character design sheet feel, professional game art quality",
  },
  game_background: {
    defaultWidth: 1536,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "game environment background, rich detail, atmospheric depth with foreground/midground/background layers, painterly game art style, suitable for parallax scrolling or static backdrop, vibrant and immersive scene",
  },
  game_ui: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "transparent",
    defaultQuality: "high",
    artDirection:
      "game UI element, clean stylized design, consistent border style, suitable for game interface, works on any background, polished and readable, fantasy/sci-fi/modern style matching game context",
  },
  print_newsletter: {
    defaultWidth: 1024,
    defaultHeight: 1536,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "abstract background design for a printed page, NO TEXT NO WORDS NO LETTERS NO TYPOGRAPHY ANYWHERE, purely visual elements only, subtle patterns and gradients, branded color accents, professional atmosphere, large open dark areas suitable for text overlay, 8.5x11 portrait proportions",
  },
  general: {
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultBackground: "opaque",
    defaultQuality: "high",
    artDirection:
      "professional quality, clean composition, modern style, suitable for app development use",
  },
};
