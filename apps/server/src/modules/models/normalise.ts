/**
 * Lenient tidying of a model's answer before it's validated (#94). It fixes presentation only, never a
 * decision: no id, fee, number, formation, choice or list is ever invented, changed or dropped.
 *
 *  - Free text (a string field allowed at least 80 characters) longer than its limit is trimmed to it.
 *  - A missing `reason` (the explanation every decision carries) becomes "(no reason given)".
 *  - A colour field (#RRGGBB) given as "1f3a93", "#1f3a93" or "#abc" is written as "#1F3A93".
 *
 * Every fix is reported, so a model's discipline is part of the public record rather than hidden.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  maxLength?: number;
  pattern?: string;
};

const PROSE_MIN = 80;
const HEX_PATTERNS = new Set(["^#[0-9A-Fa-f]{6}$", "^#[0-9a-fA-F]{6}$"]);
/** Fields that only explain a decision; a missing one is filled, never a decision itself. */
const EXPLANATIONS = new Set(["reason"]);

export function normalise(value: unknown, schema: unknown, path = ""): { value: unknown; fixes: string[] } {
  const fixes: string[] = [];
  const walk = (v: Json, s: Schema | undefined, at: string): Json => {
    if (!s) return v;
    if (typeof v === "string") {
      if (s.pattern && HEX_PATTERNS.has(s.pattern)) {
        const hex = v.trim().replace(/^#/, "");
        const full = /^[0-9a-f]{3}$/i.test(hex) ? [...hex].map((c) => c + c).join("") : hex;
        if (/^[0-9a-f]{6}$/i.test(full) && `#${full.toUpperCase()}` !== v) {
          fixes.push(`${at}: colour written as #RRGGBB`);
          return `#${full.toUpperCase()}`;
        }
      }
      if (s.maxLength !== undefined && s.maxLength >= PROSE_MIN && v.length > s.maxLength) {
        fixes.push(`${at}: trimmed from ${v.length} to ${s.maxLength} characters`);
        const cut = v.slice(0, s.maxLength - 1);
        const space = cut.lastIndexOf(" ");
        return `${space > s.maxLength * 0.6 ? cut.slice(0, space) : cut}…`;
      }
      return v;
    }
    if (Array.isArray(v)) return s.items ? v.map((x, i) => walk(x, s.items, `${at}.${i}`)) : v;
    if (v && typeof v === "object") {
      const out: { [k: string]: Json } = { ...v };
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        const here = at ? `${at}.${k}` : k;
        if (k in out) out[k] = walk(out[k]!, sub, here);
        else if (EXPLANATIONS.has(k) && (s.required ?? []).includes(k) && sub.type === "string") {
          out[k] = "(no reason given)";
          fixes.push(`${here}: missing, filled with "(no reason given)"`);
        }
      }
      return out;
    }
    return v;
  };
  return { value: walk(value as Json, schema as Schema, path), fixes };
}
