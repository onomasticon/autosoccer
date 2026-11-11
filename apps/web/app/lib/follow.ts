/**
 * "Follow a club": one followed club per browser, stored locally (no accounts, nothing sent to
 * the server, so edge-cached pages stay identical for everyone). The server always renders the
 * "unknown" state; the browser reads storage after hydration, so there's no hydration mismatch.
 */
import { useCallback, useSyncExternalStore } from "react";

export const FOLLOW_KEY = "autosoccer.followedClub";
const VERSION = 1;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface FollowRecord {
  v: typeof VERSION;
  slug: string;
  since: string;
}

/** Parses a stored value; anything malformed, from another version or not a slug is ignored. */
export function parseFollow(raw: string | null): FollowRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FollowRecord>;
    if (v?.v !== VERSION || typeof v.slug !== "string" || !SLUG.test(v.slug) || v.slug.length > 64) return null;
    return { v: VERSION, slug: v.slug, since: typeof v.since === "string" ? v.since : "" };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked (private mode, sandbox)
  }
}

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function readFollowedSlug(): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const rec = parseFollow(s.getItem(FOLLOW_KEY));
    if (!rec && s.getItem(FOLLOW_KEY) !== null) s.removeItem(FOLLOW_KEY); // drop corrupt/stale-format values
    return rec?.slug ?? null;
  } catch {
    return null;
  }
}

export function followClub(slug: string) {
  if (!SLUG.test(slug)) return;
  try {
    storage()?.setItem(FOLLOW_KEY, JSON.stringify({ v: VERSION, slug, since: new Date().toISOString() }));
  } catch {
    // quota or blocked storage: following just doesn't persist
  }
  emit();
}

export function unfollowClub() {
  try {
    storage()?.removeItem(FOLLOW_KEY);
  } catch {
    // ignore
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === FOLLOW_KEY) cb(); // other tabs
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Sentinel for "not known yet": the server render and the hydration pass. */
export const UNKNOWN = "\u0000unknown";

/**
 * The followed club's slug: `UNKNOWN` during SSR and hydration, then `null` (none) or the slug.
 */
export function useFollowedClub() {
  const slug = useSyncExternalStore(subscribe, readFollowedSlug, () => UNKNOWN);
  return {
    slug: slug === UNKNOWN ? null : slug,
    known: slug !== UNKNOWN,
    follow: useCallback((s: string) => followClub(s), []),
    unfollow: useCallback(() => unfollowClub(), []),
  };
}
