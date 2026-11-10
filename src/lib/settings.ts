// Per-user local settings (persisted in localStorage).
import { Store, useStore } from './store';

export type Theme = 'system' | 'light' | 'dark';
export interface LocalSettings {
  theme: Theme;
  fontSize: number;
  colWidths: Record<string, number>; // by speech key
  name: string;
  color: string;
  sound: boolean;
  readFontSize: number; // extensions reading mode
  notifyPresence: boolean; // toast when my partner joins/leaves
  presenceSound: boolean; // soft sound with those toasts
}

export const USER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#ef4444'];
export const DEFAULT_COL_WIDTH = 230;

const KEY = 'pf.settings';
function load(): LocalSettings {
  const base: LocalSettings = {
    theme: 'system',
    fontSize: 14,
    colWidths: {},
    name: '',
    color: USER_COLORS[Math.floor(Math.random() * 2)],
    sound: false,
    readFontSize: 24,
    notifyPresence: true,
    presenceSound: false,
  };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    base.theme = (localStorage.getItem('pf.theme') as Theme) || base.theme;
    return { ...base, ...s, theme: base.theme };
  } catch {
    return base;
  }
}

export const settings = new Store<LocalSettings>(load());
settings.subscribe(() => {
  const s = settings.get();
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem('pf.theme', s.theme);
  } catch {}
  applyTheme();
  document.documentElement.style.setProperty('--cell-font', `${s.fontSize}px`);
});

export function useSettings<S = LocalSettings>(sel?: (s: LocalSettings) => S) {
  return useStore(settings, sel);
}
export const patchSettings = (p: Partial<LocalSettings>) => settings.set((s) => ({ ...s, ...p }));

const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const t = settings.get().theme;
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.documentElement.classList.toggle('dark', dark);
}
mq.addEventListener('change', applyTheme);
applyTheme();
document.documentElement.style.setProperty('--cell-font', `${settings.get().fontSize}px`);

export function colWidth(key: string) {
  return settings.get().colWidths[key] ?? DEFAULT_COL_WIDTH;
}

/** Show a partner who picked my cursor color in a different, distinct color (stable per partner). */
export function partnerColor(theirs: string, mine: string, salt: string | number = 0): string {
  if (theirs !== mine) return theirs;
  const pool = USER_COLORS.filter((c) => c !== mine);
  const n = typeof salt === 'number' ? salt : [...salt].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return pool[n % pool.length];
}
