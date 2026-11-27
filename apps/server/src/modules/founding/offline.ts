/**
 * A deterministic offline founder for tests and keyless rehearsals. It is NOT a model, and its
 * submissions are recorded with provider "offline" so they're never mistaken for one. It behaves
 * the way real founders might: many pick from the same few popular names in round 1 (clashes), some
 * pick illegible colours, and it fixes what the validator reports.
 */
import { createHash } from "node:crypto";
import { CREST_PATTERNS, CREST_SHAPES, FoundingCharter, KIT_PATTERNS } from "@autosoccer/contracts";
import type { LlmClient, LlmRequest, LlmResponse } from "../agents/llm.ts";

const POPULAR = ["Northern Lights", "Harbour Athletic", "Iron Valley"];
const PLACES = [
  "Ashby",
  "Brackwater",
  "Calder",
  "Dunmore",
  "Elmstead",
  "Fenwick",
  "Galloway",
  "Hollins",
  "Inverby",
  "Jarrow",
  "Kestrel",
  "Linden",
  "Marston",
  "Netherby",
  "Oakham",
  "Pellow",
  "Quarry",
  "Rowan",
  "Sutter",
  "Thornby",
  "Ulverby",
  "Vantage",
];
const SUFFIX = [
  "Rovers",
  "Town",
  "Albion",
  "Wanderers",
  "Athletic",
  "Forge",
  "Harriers",
  "Rangers",
  "Comets",
  "Mariners",
];
const COLOURS = [
  "#1F3A93",
  "#C0392B",
  "#117A65",
  "#6C3483",
  "#D35400",
  "#1B2631",
  "#F1C40F",
  "#2E86C1",
  "#FDFEFE",
  "#F5F0E6",
  "#E91E63",
  "#00897B",
];

const h = (s: string) => createHash("sha256").update(s).digest();

export interface OfflineFounderOptions {
  /** Founders (by slug) whose round-1 answer is malformed (not a charter at all). */
  malformed?: string[];
  /** Founders that never fix their problems (to exercise the awaiting status). */
  stubborn?: string[];
}

export function offlineFounder(opts: OfflineFounderOptions = {}): LlmClient {
  return {
    provider: "offline",
    model: "offline:founder",
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      const ctx = req.context as { founder: string; round: number; feedback: string[] };
      if (opts.malformed?.includes(ctx.founder) && ctx.round === 1) throw new Error("output was not JSON");
      const k = h(ctx.founder);
      const stubborn = opts.stubborn?.includes(ctx.founder);
      const fixing = ctx.round > 1 && !stubborn;
      // Each resubmission tries a different place and suffix, as a founder told "taken" would.
      const shift = fixing ? ctx.round * 7 + k[16]! : 0;
      const place = PLACES[(k[0]! + shift) % PLACES.length]!;
      // Round 1: a third of founders reach for a popular name.
      const popular = k[1]! % 3 === 0 || stubborn;
      const name =
        popular && !fixing ? POPULAR[k[2]! % POPULAR.length]! : `${place} ${SUFFIX[(k[3]! + shift) % SUFFIX.length]}`;
      const sn = (popular && !fixing ? name : `${place}${SUFFIX[(k[3]! + shift) % SUFFIX.length]}`).replace(
        /[^A-Za-z]/g,
        "",
      );
      const shortName = fixing
        ? `${sn[0]}${sn[1 + (k[4]! % (sn.length - 1))]}${String.fromCharCode(65 + ((k[5]! + shift) % 26))}`.toUpperCase()
        : sn.slice(0, 3).toUpperCase();
      let primary = COLOURS[k[6]! % COLOURS.length]!;
      let secondary = COLOURS[k[7]! % COLOURS.length]!;
      if (k[8]! % 4 === 0 && !fixing) secondary = primary; // illegible on purpose: the validator objects
      if (fixing || secondary === primary) {
        primary = COLOURS[k[6]! % 6]!; // a dark colour
        secondary = COLOURS[8 + (k[7]! % 2)]!; // a light one
      }
      const charter = {
        name,
        shortName,
        nickname: `The ${["Foxes", "Kites", "Masons", "Otters", "Herons", "Badgers", "Ravens", "Stags"][k[9]! % 8]} of ${place}`,
        city: place,
        stadium: `${place} ${["Park", "Lane", "Ground", "Meadow", "Works"][k[10]! % 5]}`,
        motto: ["Together forward", "Steady hands", "Run for it", "Built to last"][k[11]! % 4]!,
        culture: "A placeholder culture written by the offline stand-in founder for rehearsals.",
        philosophy: "Placeholder philosophy written by the offline founder, not a model.",
        recruitment: "Placeholder recruitment approach written by the offline founder, not a model.",
        brand: {
          primaryColor: primary,
          secondaryColor: secondary,
          crest: {
            shape: CREST_SHAPES[k[12]! % CREST_SHAPES.length]!,
            glyph: shortName.slice(0, 1 + (k[13]! % 3)),
            pattern: CREST_PATTERNS[k[14]! % CREST_PATTERNS.length]!,
          },
          home: {
            shirt: primary,
            shorts: secondary,
            socks: primary,
            pattern: KIT_PATTERNS[k[15]! % KIT_PATTERNS.length]!,
            trim: secondary,
          },
          away: { shirt: secondary, shorts: primary, socks: secondary, pattern: "plain" as const, trim: primary },
        },
      };
      const output = req.schema.parse(FoundingCharter.parse(charter));
      return {
        output,
        provider: "offline",
        model: "offline:founder",
        inputTokens: Math.ceil(req.prompt.length / 4),
        outputTokens: 450,
      };
    },
  };
}
