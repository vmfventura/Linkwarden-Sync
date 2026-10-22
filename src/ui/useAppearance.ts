import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ThemePreference, ThemeStore } from '../core/theme';

export function useAppearance(store: ThemeStore, initial: ThemePreference) {
  const [preference, setPreference] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  const active = useRef(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const before = revision.current;
    const value = await store.read();
    if (active.current && revision.current === before) setPreference(value);
  }, [store]);
  useEffect(() => {
    active.current = true;
    const off = store.subscribe(value => { revision.current++; if (active.current) setPreference(value); });
    void refresh().catch(() => { if (active.current) setFailed(true); });
    return () => { active.current = false; revision.current++; off(); };
  }, [store, refresh]);
  useLayoutEffect(() => { document.documentElement.dataset.theme = preference; }, [preference]);
  const change = async (value: ThemePreference) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setFailed(false);
    try { await store.write(value); await refresh(); }
    catch { if (active.current) setFailed(true); }
    finally { pending.current = false; if (active.current) setSaving(false); }
  };
  return { preference, saving, failed, change };
}
