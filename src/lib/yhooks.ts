import { useEffect, useReducer, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

/** Re-render when a Y type changes (shallow, or deep). */
export function useY(t: Y.AbstractType<any> | null | undefined, deep = false) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!t) return;
    const h = () => bump();
    if (deep) t.observeDeep(h);
    else t.observe(h);
    return () => (deep ? t.unobserveDeep(h) : t.unobserve(h));
  }, [t, deep]);
}

/** Subscribe to a derived value from a Y type, re-rendering only when it changes. */
export function useYValue<T>(t: Y.AbstractType<any> | null | undefined, get: () => T, deep = false): T {
  return useSyncExternalStore(
    (cb) => {
      if (!t) return () => {};
      if (deep) t.observeDeep(cb);
      else t.observe(cb);
      return () => (deep ? t.unobserveDeep(cb) : t.unobserve(cb));
    },
    get,
  );
}

/** Like useY(t, deep) but re-renders at most every `ms` (for panels that re-scan the whole flow). */
export function useYThrottled(t: Y.AbstractType<any> | null | undefined, ms = 200) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!t) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const h = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        bump();
      }, ms);
    };
    t.observeDeep(h);
    return () => {
      t.unobserveDeep(h);
      if (timer) clearTimeout(timer);
    };
  }, [t, ms]);
}
