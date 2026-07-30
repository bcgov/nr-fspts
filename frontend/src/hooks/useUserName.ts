import { useEffect, useSyncExternalStore } from 'react';

import { peek, request, subscribe } from '@/lib/userNameStore';

export interface UserNameState {
  /** Text to display — the resolved display name, or the raw id fallback. */
  text: string;
  /** True while the lookup is in flight (caller shows a spinner). */
  loading: boolean;
}

/**
 * Resolves a single user id (IDIR / BCeID) to a display name via the shared
 * session cache. Returns the raw id immediately (with {@code loading: true})
 * and swaps to the resolved name once the batched lookup lands. Cache hits
 * return the name synchronously with no loading flash. Unresolvable ids fall
 * back to the raw id with {@code loading: false}.
 */
export function useUserName(rawId: string | null | undefined): UserNameState {
  const id = (rawId ?? '').trim();

  const cached = useSyncExternalStore(
    subscribe,
    () => (id ? peek(id) : ''),
    () => (id ? peek(id) : ''),
  );

  useEffect(() => {
    if (id) request(id);
  }, [id]);

  if (!id) return { text: '', loading: false };
  if (cached === undefined) return { text: id, loading: true };
  // '' → looked up but unresolved: show the raw id. Otherwise the name.
  return { text: cached === '' ? id : cached, loading: false };
}
