import sharp from "sharp";

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  color?: string;
  maxWidth?: number;
  lineHeight?: number;
  align?: "left" | "center" | "right";
}

export interface NewsletterContent {
  headline: string;
  sections: { heading: string; body: string }[];
  footer?: string;
  accentColor?: string;
  bgColor?: string;
  textColor?: string;
  logoTopOffset?: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number
): string[] {
  const charWidth = fontSize * 0.52;
  const maxChars = Math.floor(maxWidth / charWidth);

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (test.length > maxChars && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

function renderTextBlockSvg(block: TextBlock): string {
  const font = block.fontFamily || "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  const weight = block.fontWeight || "normal";
  const color = block.color || "#ffffff";
  const lineHeight = block.lineHeight || block.fontSize * 1.5;
  const align = block.align || "left";
  const maxWidth = block.maxWidth || 900;

  const lines = wrapText(block.text, maxWidth, block.fontSize);

  let anchor = "start";
  let xPos = block.x;
  if (align === "center") {
    anchor = "middle";
    xPos = block.x + maxWidth / 2;
  } else if (align === "right") {
    anchor = "end";
    xPos = block.x + maxWidth;
  }

  return lines
    .map(
      (line, i) =>
        `<text x="${xPos}" y="${block.y + i * lineHeight}" ` +
        `font-family="${font}" font-size="${block.fontSize}" ` +
        `font-weight="${weight}" fill="${color}" ` +
        `text-anchor="${anchor}">${escapeXml(line)}</text>`
    )
    .join("\n");
}

export function buildNewsletterSvg(
  width: number,
  height: number,
  content: NewsletterContent
): string {
  const accent = content.accentColor || "#10b981";
  const textColor = content.textColor || "#d4d4d8";
  const headlineColor = "#ffffff";
  const margin = 72;
  const contentWidth = width - margin * 2;
  const dividers: string[] = [];

  const blocks: TextBlock[] = [];

  // If a logo is placed at top, push all content below it
  const topStart = content.logoTopOffset ? content.logoTopOffset + 20 : 0;

  // Calculate total content height first to distribute vertically
  const headlineFontSize = 52;
  const headingFontSize = 24;
  const bodyFontSize = 19;
  const headlineLineH = 62;
  const headingLineH = 32;
  const bodyLineH = 30;

  // Measure total content height to distribute spacing
  const headlineLines = wrapText(content.headline, contentWidth, headlineFontSize);
  let totalContentH = headlineLines.length * headlineLineH + 20 + topStart;
  for (const section of content.sections) {
    const hLines = wrapText(section.heading, contentWidth, headingFontSize);
    const bLines = wrapText(section.body, contentWidth, bodyFontSize);
    totalContentH += hLines.length * headingLineH + 10;
    totalContentH += bLines.length * bodyLineH + 10;
  }
  const footerH = content.footer ? 50 : 0;
  const availableH = height - 100 - footerH; // top/bottom padding
  const sectionCount = content.sections.length;
  // Spacing between sections, distributed evenly
  const sectionGap = Math.min(
    60,
    Math.max(30, (availableH - totalContentH) / (sectionCount + 1))
  );

  let yOffset = 90 + topStart;

  // Headline (mixed case, not all caps)
  blocks.push({
    text: content.headline,
    x: margin,
    y: yOffset,
    fontSize: headlineFontSize,
    fontWeight: "bold",
    color: headlineColor,
    maxWidth: contentWidth,
    lineHeight: headlineLineH,
  });
  yOffset += headlineLines.length * headlineLineH + 16;

  // Accent bar below headline
  dividers.push(
    `<rect x="${margin}" y="${yOffset}" width="100" height="4" fill="${accent}" rx="2" />`
  );
  yOffset += sectionGap;

  // Sections
  for (let i = 0; i < content.sections.length; i++) {
    const section = content.sections[i];

    // Section heading (mixed case, accent color)
    blocks.push({
      text: section.heading,
      x: margin,
      y: yOffset,
      fontSize: headingFontSize,
      fontWeight: "bold",
      color: accent,
      maxWidth: contentWidth,
      lineHeight: headingLineH,
    });

    const hLines = wrapText(section.heading, contentWidth, headingFontSize);
    yOffset += hLines.length * headingLineH + 16;

    // Section body
    blocks.push({
      text: section.body,
      x: margin,
      y: yOffset,
      fontSize: bodyFontSize,
      fontWeight: "normal",
      color: textColor,
      maxWidth: contentWidth,
      lineHeight: bodyLineH,
    });

    const bLines = wrapText(section.body, contentWidth, bodyFontSize);
    yOffset += bLines.length * bodyLineH;

    // Thin divider line between sections (not after the last one)
    if (i < content.sections.length - 1) {
      yOffset += sectionGap * 0.4;
      dividers.push(
        `<line x1="${margin}" y1="${yOffset}" x2="${margin + contentWidth}" y2="${yOffset}" ` +
          `stroke="${accent}" stroke-opacity="0.25" stroke-width="1" />`
      );
      yOffset += sectionGap * 0.6;
    }
  }

  // Footer
  if (content.footer) {
    const footerY = height - 55;
    // Thin line above footer
    dividers.push(
      `<line x1="${margin}" y1="${footerY - 20}" x2="${margin + contentWidth}" y2="${footerY - 20}" ` +
        `stroke="${accent}" stroke-opacity="0.3" stroke-width="1" />`
    );
    blocks.push({
      text: content.footer,
      x: margin,
      y: footerY,
      fontSize: 18,
      fontWeight: "bold",
      color: accent,
      maxWidth: contentWidth,
      lineHeight: 24,
      align: "center",
    });
  }

  const textElements = blocks.map(renderTextBlockSvg).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${dividers.join("\n  ")}
  ${textElements}
</svg>`;
}

export async function overlayTextOnImage(
  imageBuffer: Buffer,
  svgText: string,
  width: number,
  height: number,
  scrimOpacity: number = 0.55
): Promise<Buffer> {
  const svgBuffer = Buffer.from(svgText);

  // Dark scrim for text readability, lets more background show through
  const scrimSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="black" opacity="${scrimOpacity}" />` +
      `</svg>`
  );

  return sharp(imageBuffer)
    .resize(width, height, { fit: "cover" })
    .composite([
      { input: scrimSvg, top: 0, left: 0 },
      { input: svgBuffer, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}
