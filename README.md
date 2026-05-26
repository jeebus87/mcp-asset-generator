# mcp-asset-generator

An MCP server that turns rough text descriptions into production-ready visual assets. You describe what you need. The server handles art direction, prompt engineering, image generation, file organization, and codebase wiring.

Works with any MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.) and uses OpenAI's image generation API under the hood.

**17 tools.** Logos, icons, banners, favicons, OG images, illustrations, email headers, print newsletters, game sprites, game characters, game backgrounds, game UI, game icons, a smart router that picks the right tool from your description, GIF creation from image sequences, and codebase wiring that finds where to plug the asset in and does it for you.

## Installation

You need an [OpenAI API key](https://platform.openai.com/api-keys) with image generation permissions.

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "asset-generator": {
      "command": "npx",
      "args": ["-y", "mcp-asset-generator"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "asset-generator": {
      "command": "npx",
      "args": ["-y", "mcp-asset-generator"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/jeebus87/mcp-asset-generator.git
cd mcp-asset-generator
npm install
npm run build
```

Create a `.env` file with your API key:

```bash
OPENAI_API_KEY=sk-...
```

The project includes a `.mcp.json` that Claude Code picks up automatically. Just open the project directory in Claude Code and the tools will be available.

For other MCP clients, point to the local build:

```json
{
  "mcpServers": {
    "asset-generator": {
      "command": "node",
      "args": ["/path/to/mcp-asset-generator/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Standalone

```bash
export OPENAI_API_KEY=sk-...
npx mcp-asset-generator
```

## Tools

### App assets

| Tool | What it generates | Default size | Background |
|------|-------------------|-------------|------------|
| `generate_logo` | Logos. Flat/minimal style, clean lines. | 1024x1024 | Transparent |
| `generate_icon` | App icons. Simple, recognizable symbols. | 1024x1024 | Transparent |
| `generate_favicon` | Favicons. Extremely simple, works at 16px. | 1024x1024 | Transparent |
| `generate_og_image` | Social share / Open Graph images. Bold, wide. | 1536x1024 | Opaque |
| `generate_banner` | Hero and header images. Cinematic, wide. | 1536x1024 | Opaque |
| `generate_illustration` | UI illustrations. Modern, friendly. | 1024x1024 | Opaque |
| `generate_newsletter_banner` | Email newsletter headers. Email-safe. | 1536x1024 | Opaque |
| `generate_print_newsletter` | Full-page print newsletters. Programmatic text, optional logo. | 1024x1536 | Opaque |

The print newsletter tool uses structured content instead of a single prompt:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `visual_prompt` | Yes | Background design (colors, patterns, brand aesthetic) |
| `headline` | Yes | Main headline text |
| `sections` | Yes | Array of `{ heading, body }` content blocks |
| `footer` | No | Footer text (URL, contact info) |
| `logo_image` | No | Path to your existing logo/banner image |
| `logo_prompt` | No | Describe a logo to generate if you don't have one |
| `accent_color` | No | Hex color for headings and accents |

Text is rendered programmatically (via sharp + SVG compositing), not by the AI image model. Every word is pixel-perfect.

### Game assets

| Tool | What it generates | Default size | Background |
|------|-------------------|-------------|------------|
| `generate_game_sprite` | 2D sprites for characters, enemies, objects, and props. | 1024x1024 | Transparent |
| `generate_game_icon` | Item/ability icons. Inventory, loot, spells. | 1024x1024 | Transparent |
| `generate_game_character` | Full-body character concept art. | 1024x1536 | Transparent |
| `generate_game_background` | Level backgrounds, environments, scenes. | 1536x1024 | Opaque |
| `generate_game_ui` | UI elements. Buttons, frames, panels, HUD. | 1024x1024 | Transparent |

`generate_game_sprite` creates individual sprite assets with clean edges suitable for any 2D game engine. Each call produces a single character, enemy, object, or prop on a transparent background, ready to drop into Unity, Godot, Phaser, or any other framework.

### Smart router

| Tool | Description |
|------|-------------|
| `generate_asset` | Infers the best asset type from your prompt and delegates to the right tool. Use this when you just want to describe what you need without picking a specific tool. |

Examples of what the router understands:
- *"I need a logo for my startup"* routes to `generate_logo`
- *"social media share image for my blog"* routes to `generate_og_image`
- *"a health potion game icon"* routes to `generate_game_icon`
- *"a knight sprite for my RPG"* routes to `generate_game_sprite`

### GIF creation

| Tool | Description |
|------|-------------|
| `create_gif` | Create an animated GIF from a folder of images (PNG, JPG, WebP). Sorts files alphabetically. Supports loop control. |

| Parameter | Default | Description |
|-----------|---------|-------------|
| `folder` | *(required)* | Path to folder containing images |
| `output` | `{folder}/animation.gif` | Output GIF path |
| `fps` | `2` | Frames per second |
| `width` | `800` | Output width (height preserves aspect ratio) |
| `loop` | `false` | Loop the animation. False = play once and stop. |
| `background` | `#ffffff` | Background color as hex. Use `transparent` for no background. |

### Codebase wiring

| Tool | Description |
|------|-------------|
| `find_asset_references` | Searches your codebase for integration points where a new asset belongs. Finds `<img src>`, `<link rel="icon">`, `<meta og:image>`, CSS `background-image`, and `import` statements. Returns a diff preview of proposed changes. |
| `apply_asset_wiring` | Applies the changes from the diff preview. Requires `confirmed: true`. No files are modified without explicit confirmation. Supports dry-run mode with `confirmed: false`. |

### Optional overrides (all tools)

Every generation tool accepts these optional parameters:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `width` | 256-4096 | Override default width |
| `height` | 256-4096 | Override default height |
| `quality` | `low`, `medium`, `high` | `low` for drafts, `high` for production |
| `background` | `transparent`, `opaque` | Override the type default |

## How it works

1. You describe what you need in plain text
2. The server picks the right asset type (or you choose explicitly)
3. Your prompt gets enhanced with type-specific art direction: style, composition, color treatment, background handling
4. The enhanced prompt hits OpenAI's image generation API
5. The response (base64) gets decoded and saved to `assets/{type}/{slug}.png`
6. You get back the file path, dimensions, model used, quality tier, and the full enhanced prompt

The art direction layer is what separates this from calling the API directly. A bare prompt like *"logo for my app"* becomes a detailed instruction covering style, composition, transparency, and format conventions specific to logos. Each asset type has its own art direction profile.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI API key |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Which model to use |
| `ASSET_OUTPUT_DIR` | `assets` | Where generated files go |

## Output structure

```
assets/
  logos/                  app-logo.png
  icons/                 camera-icon.png
  favicons/              star-favicon.png
  banners/               hero-banner.png
  og-images/             product-launch.png
  illustrations/         onboarding.png
  newsletter-banners/    monthly-update.png
  newsletters/           launch-announcement.png
  game/
    sprites/             knight.png
    icons/               health-potion.png
    characters/          cyberpunk-samurai.png
    backgrounds/         enchanted-forest.png
    ui/                  inventory-frame.png
  general/               misc.png
```

## Error handling

The server returns structured, actionable error messages for every failure mode:

| Error | What you see |
|-------|-------------|
| Missing API key | Server exits immediately with setup instructions |
| Invalid key (401) | Points you to the API keys page |
| Org verification needed (403) | Links to billing/verification settings |
| Content policy rejection | Tells you which prompt triggered it and how to rephrase |
| Rate limit (429) | Tells you how long to wait and suggests using `quality: "low"` |
| Billing issues (402) | Links to add credits |

All errors use the MCP `isError: true` pattern so your AI assistant can reason about failures and suggest fixes.

## License

MIT
