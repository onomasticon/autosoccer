/**
 * Founding charter validation (#95): safe text, unique names, legible colours and distinct kits.
 * Every reason is phrased so the founder can fix it in its next submission.
 */
import { colourDistance, contrastRatio, type FoundingCharter, kitsClash } from "@autosoccer/contracts";

/** Lowercased, accents and punctuation removed, "fc/afc/club" dropped: what counts as the same name. */
export function normaliseName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(a?fc|club|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Real football clubs a fictional club mustn't impersonate (a small, deliberately conservative list). */
const REAL_CLUBS = [
  "real madrid",
  "barcelona",
  "manchester united",
  "manchester city",
  "liverpool",
  "arsenal",
  "chelsea",
  "tottenham",
  "juventus",
  "inter milan",
  "ac milan",
  "bayern",
  "borussia dortmund",
  "paris saint germain",
  "ajax",
  "benfica",
  "porto",
  "celtic",
  "rangers fc",
  "boca juniors",
  "river plate",
  "flamengo",
];

const UNSAFE = [
  { re: /https?:\/\/|www\.|\.(com|net|org|io|ai)\b/i, why: "contains a link" },
  { re: /@[a-z0-9_]{2,}/i, why: "contains a handle or email" },
  { re: /<[^>]+>|[{}]/, why: "contains markup" },
  // Control characters and invisible/bidi formatting marks (matching them is the point).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is intended
  { re: /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/, why: "contains control or invisible characters" },
  {
    re: /\b(openai|anthropic|google|gemini|claude|gpt|mistral|deepseek|qwen|llama|grok|cohere|kimi|glm|minimax)\b/i,
    why: "names an AI model or company",
  },
];

export interface Taken {
  names: Set<string>;
  shortNames: Set<string>;
  nicknames: Set<string>;
}

export function emptyTaken(): Taken {
  return { names: new Set(), shortNames: new Set(), nicknames: new Set() };
}

export function claim(t: Taken, c: FoundingCharter) {
  t.names.add(normaliseName(c.name));
  t.shortNames.add(c.shortName);
  t.nicknames.add(normaliseName(c.nickname));
}

/** Why a charter can't be accepted (empty when it can). */
export function charterProblems(c: FoundingCharter, taken: Taken): string[] {
  const out: string[] = [];
  const fields: Array<[string, string]> = [
    ["name", c.name],
    ["nickname", c.nickname],
    ["city", c.city],
    ["stadium", c.stadium],
    ["motto", c.motto],
    ["culture", c.culture],
    ["philosophy", c.philosophy],
    ["recruitment", c.recruitment],
  ];
  for (const [f, v] of fields) for (const u of UNSAFE) if (u.re.test(v)) out.push(`${f} ${u.why}`);
  const n = normaliseName(c.name);
  if (!n) out.push("name has no letters");
  if (REAL_CLUBS.some((r) => n.includes(r))) out.push("name imitates a real club");
  if (taken.names.has(n)) out.push(`name "${c.name}" is already taken`);
  if (taken.shortNames.has(c.shortName)) out.push(`short name ${c.shortName} is already taken`);
  if (taken.nicknames.has(normaliseName(c.nickname))) out.push(`nickname "${c.nickname}" is already taken`);
  const b = c.brand;
  if (contrastRatio(b.primaryColor, b.secondaryColor) < 3)
    out.push(
      `primary and secondary colours contrast ${contrastRatio(b.primaryColor, b.secondaryColor).toFixed(1)}:1; at least 3:1 is needed`,
    );
  if (kitsClash(b.home, b.away)) out.push("home and away shirts are too similar to tell apart");
  for (const [side, k] of [
    ["home", b.home],
    ["away", b.away],
  ] as const)
    if (k.pattern !== "plain" && colourDistance(k.shirt, k.trim) < 60)
      out.push(`${side} kit's pattern is invisible against its shirt`);
  return out;
}

/** A URL slug for a club name, unique against `used`. */
export function clubSlug(name: string, used: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "club";
  let s = base;
  for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
  return s;
}
