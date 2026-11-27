/**
 * Club brand specs and their shared, deterministic renderer (#95). A founder describes its crest and
 * kits as structured data (the same tool for every model, text-only ones included); the platform
 * renders them as flat vector SVG in the Pop Arcade style, identically on the server and the web.
 * The same spec always produces the same bytes.
 */
import { z } from "zod";
import { HexColor } from "./common.ts";

export const CREST_SHAPES = ["shield", "circle", "hexagon", "diamond"] as const;
export const CREST_PATTERNS = ["plain", "stripe", "chevron", "quartered", "star", "wave"] as const;
export const KIT_PATTERNS = ["plain", "stripes", "hoops", "sash", "halves", "pinstripe"] as const;

export const CrestSpec = z.object({
  shape: z.enum(CREST_SHAPES),
  /** 1–3 letters shown on the badge. */
  glyph: z
    .string()
    .regex(/^[A-Z0-9]{1,3}$/)
    .describe("1–3 capital letters or digits"),
  pattern: z.enum(CREST_PATTERNS).default("plain"),
});
export type CrestSpec = z.infer<typeof CrestSpec>;

export const KitSpec = z.object({
  shirt: HexColor,
  shorts: HexColor,
  socks: HexColor,
  pattern: z.enum(KIT_PATTERNS).default("plain"),
  /** The pattern's second colour. */
  trim: HexColor,
});
export type KitSpec = z.infer<typeof KitSpec>;

export const BrandSpec = z.object({
  primaryColor: HexColor,
  secondaryColor: HexColor,
  crest: CrestSpec,
  home: KitSpec,
  away: KitSpec,
});
export type BrandSpec = z.infer<typeof BrandSpec>;

/** WCAG relative luminance contrast ratio between two #RRGGBB colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const c = [1, 3, 5]
      .map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

/** Perceptual distance between two colours (redmean approximation, 0–~765). */
export function colourDistance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a) as [number, number, number];
  const [r2, g2, b2] = p(b) as [number, number, number];
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/** Two shirts clash on the pitch when they're this close (the viewer then swaps to the away kit). */
export const KIT_CLASH_DISTANCE = 150;
export const kitsClash = (a: KitSpec, b: KitSpec) => colourDistance(a.shirt, b.shirt) < KIT_CLASH_DISTANCE;

/** Black or white text, whichever reads better on a colour. */
export const inkOn = (bg: string) =>
  contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#20203B") ? "#FFFFFF" : "#20203B";

const SHAPES: Record<CrestSpec["shape"], string> = {
  shield: "M50 4 L92 16 V48 C92 74 74 90 50 98 C26 90 8 74 8 48 V16 Z",
  circle: "M50 4 A46 46 0 1 1 49.99 4 Z",
  hexagon: "M50 4 L90 27 V73 L50 96 L10 73 V27 Z",
  diamond: "M50 3 L97 50 L50 97 L3 50 Z",
};

const CREST_MARKS: Record<CrestSpec["pattern"], string> = {
  plain: "",
  stripe: '<rect x="42" y="0" width="16" height="100"/>',
  chevron: '<path d="M0 62 L50 38 L100 62 V78 L50 54 L0 78 Z"/>',
  quartered: '<rect x="50" y="0" width="50" height="50"/><rect x="0" y="50" width="50" height="50"/>',
  star: '<path d="M50 14 L57 30 L75 31 L61 42 L66 59 L50 49 L34 59 L39 42 L25 31 L43 30 Z"/>',
  wave: '<path d="M0 66 C17 56 33 76 50 66 C67 56 83 76 100 66 V82 C83 92 67 72 50 82 C33 92 17 72 0 82 Z"/>',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The crest as a standalone SVG document (100 × 100 viewBox). */
export function crestSvg(b: Pick<BrandSpec, "primaryColor" | "secondaryColor" | "crest">, label = "crest"): string {
  const { crest } = b;
  const id = `c${hashHex(JSON.stringify(b)).slice(0, 8)}`;
  const marks = CREST_MARKS[crest.pattern] ?? "";
  const glyphColor = inkOn(
    crest.pattern === "quartered" || crest.pattern === "stripe" ? b.secondaryColor : b.primaryColor,
  );
  const glyph = crest.pattern === "star" ? "" : crest.glyph;
  const y = crest.pattern === "wave" || crest.pattern === "chevron" ? 40 : 53;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${esc(label)}">`,
    `<defs><clipPath id="${id}"><path d="${SHAPES[crest.shape]}"/></clipPath></defs>`,
    `<path d="${SHAPES[crest.shape]}" fill="${b.primaryColor}"/>`,
    marks ? `<g clip-path="url(#${id})" fill="${b.secondaryColor}">${marks}</g>` : "",
    `<path d="${SHAPES[crest.shape]}" fill="none" stroke="${b.secondaryColor}" stroke-width="5"/>`,
    `<path d="${SHAPES[crest.shape]}" fill="none" stroke="#20203B" stroke-opacity="0.18" stroke-width="1.5"/>`,
    glyph
      ? `<text x="50" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-style="italic" font-size="${glyph.length > 1 ? 38 : 50}" fill="${glyphColor}">${esc(glyph)}</text>`
      : "",
    "</svg>",
  ].join("");
}

const SHIRT = "M30 10 L42 6 C45 12 55 12 58 6 L70 10 L90 26 L80 40 L72 34 V74 H28 V34 L20 40 L10 26 Z";
const KIT_MARKS: Record<KitSpec["pattern"], string> = {
  plain: "",
  stripes: [34, 46, 58].map((x) => `<rect x="${x}" y="0" width="6" height="80"/>`).join(""),
  pinstripe: [32, 38, 44, 50, 56, 62, 68].map((x) => `<rect x="${x}" y="0" width="1.6" height="80"/>`).join(""),
  hoops: [22, 38, 54].map((y) => `<rect x="0" y="${y}" width="100" height="8"/>`).join(""),
  sash: '<path d="M24 22 L36 16 L78 66 L68 74 Z"/>',
  halves: '<rect x="50" y="0" width="50" height="80"/>',
};

/** A kit (shirt, shorts, socks) as a standalone SVG document (100 × 120 viewBox). */
export function kitSvg(k: KitSpec, label = "kit"): string {
  const id = `k${hashHex(JSON.stringify(k)).slice(0, 8)}`;
  const marks = KIT_MARKS[k.pattern] ?? "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" role="img" aria-label="${esc(label)}">`,
    `<defs><clipPath id="${id}"><path d="${SHIRT}"/></clipPath></defs>`,
    `<path d="${SHIRT}" fill="${k.shirt}"/>`,
    marks ? `<g clip-path="url(#${id})" fill="${k.trim}">${marks}</g>` : "",
    `<path d="${SHIRT}" fill="none" stroke="#20203B" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M30 76 H70 L72 96 H53 L50 86 L47 96 H28 Z" fill="${k.shorts}" stroke="#20203B" stroke-width="2" stroke-linejoin="round"/>`,
    `<rect x="31" y="100" width="13" height="16" rx="2" fill="${k.socks}" stroke="#20203B" stroke-width="2"/>`,
    `<rect x="56" y="100" width="13" height="16" rx="2" fill="${k.socks}" stroke="#20203B" stroke-width="2"/>`,
    "</svg>",
  ].join("");
}

/** FNV-1a, hex: a stable id for clip paths (no crypto dependency in the browser). */
export function hashHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
