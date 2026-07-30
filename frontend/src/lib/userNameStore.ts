import { resolveUserNames } from '@/services/fspSearch';

/**
 * Session-scoped cache + batching layer for user-id → display-name lookups.
 *
 * Every {@code <UserName>} on screen reads from here through
 * {@link useUserName}. When an id hasn't been looked up yet it's queued; a
 * short debounce collapses all the ids that mount in the same tick (e.g. a
 * whole table's worth of cells) into ONE `POST /users/resolve` request. The
 * result is memoised in {@code sessionStorage} so re-renders and client-side
 * navigations are instant, while a new browser session starts fresh (so
 * names stay current) — per product requirement.
 *
 * Cache values:
 *   - a non-empty string → the resolved display name
 *   - `''`               → looked up but unresolved (keep showing the raw id)
 *   - key absent         → not looked up yet
 */

const STORAGE_KEY = 'fsp.userNames.v1';
// Debounce window for coalescing mounts into a single batch request.
const FLUSH_DELAY_MS = 50;

type Cache = Record<string, string>;

let cache: Cache = loadCache();
const subscribers = new Set<() => void>();
const pending = new Set<string>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;

function loadCache(): Cache {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage disabled / over quota — the in-memory cache still works for
    // the current page; we just lose cross-navigation persistence.
  }
}

function notify(): void {
  subscribers.forEach((fn) => fn());
}

/** Subscribe to cache changes (used by {@link useUserName}). */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Current cache entry for an id: the resolved name, `''` if looked-up but
 * unresolved, or `undefined` if not yet looked up.
 */
export function peek(id: string): string | undefined {
  return cache[id];
}

/** Queue an id for resolution if it isn't already known or in flight. */
export function request(rawId: string | null | undefined): void {
  const id = (rawId ?? '').trim();
  if (!id) return;
  if (id in cache) return;
  if (pending.has(id)) return;
  pending.add(id);
  if (flushHandle == null) {
    flushHandle = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }
}

async function flush(): Promise<void> {
  flushHandle = null;
  if (pending.size === 0) return;
  const ids = [...pending];
  pending.clear();
  try {
    const resolved = await resolveUserNames(ids);
    for (const id of ids) {
      cache[id] = resolved[id] ?? ''; // missing from response → unresolved
    }
    persist();
  } catch {
    // Best-effort: on a failed request mark the ids resolved-to-nothing in
    // memory (so the spinner stops and the raw id shows) but DON'T persist,
    // so a full reload retries them.
    for (const id of ids) {
      if (!(id in cache)) cache[id] = '';
    }
  }
  notify();
}
