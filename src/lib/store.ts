// Tiny external store helper usable with useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set = (v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(this.value) : v;
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useStore<T, S = T>(store: Store<T>, sel?: (v: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => (sel ? sel(store.get()) : (store.get() as unknown as S)));
}
