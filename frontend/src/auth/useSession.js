import { useSyncExternalStore } from 'react';
import { subscribe, getSession } from './auth';

export function useSession() {
  return useSyncExternalStore(subscribe, getSession, () => null);
}
