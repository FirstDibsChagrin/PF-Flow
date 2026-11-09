// Synced round timers stored in the flow doc. Times are computed from a server-calibrated clock
// so both partners see the same countdown.
import * as Y from 'yjs';
import { LOCAL } from './sync';
import { serverNow } from './transport';
import { timersMap, type Mode } from './model';
import type { TimerSettings } from './room';

export interface ClockState {
  remaining: number; // ms remaining when last paused / started
  startedAt: number | null; // server ms when started; null = paused
}
export interface SpeechSlot {
  id: string;
  label: string;
  short: string;
  len: keyof TimerSettings;
}

export function speechSequence(mode: Mode): SpeechSlot[] {
  const f = mode === 'aff' ? 'Aff' : 'Con';
  const s = mode === 'aff' ? 'Con' : 'Aff';
  const fa = f[0] === 'A' ? 'A' : 'N';
  const sa = s[0] === 'A' ? 'A' : 'N';
  return [
    { id: 'C1', label: `${f} Constructive`, short: `${fa}C`, len: 'C' },
    { id: 'C2', label: `${s} Constructive`, short: `${sa}C`, len: 'C' },
    { id: 'X1', label: 'First Crossfire', short: 'CX1', len: 'CX' },
    { id: 'R1', label: `${f} Rebuttal`, short: `${fa}R`, len: 'R' },
    { id: 'R2', label: `${s} Rebuttal`, short: `${sa}R`, len: 'R' },
    { id: 'X2', label: 'Second Crossfire', short: 'CX2', len: 'CX' },
    { id: 'S1', label: `${f} Summary`, short: `${fa}S`, len: 'S' },
    { id: 'S2', label: `${s} Summary`, short: `${sa}S`, len: 'S' },
    { id: 'GX', label: 'Grand Crossfire', short: 'GCX', len: 'GCX' },
    { id: 'F1', label: `${f} Final Focus`, short: `${fa}FF`, len: 'F' },
    { id: 'F2', label: `${s} Final Focus`, short: `${sa}FF`, len: 'F' },
  ];
}

export function clockRemaining(c: ClockState | undefined, fallback: number): number {
  if (!c) return fallback;
  if (c.startedAt == null) return c.remaining;
  return c.remaining - (serverNow() - c.startedAt);
}

export type TimerKey = 'speech' | 'prep-aff' | 'prep-con';

export function readClock(d: Y.Doc, key: TimerKey): ClockState | undefined {
  return timersMap(d).get(key);
}
function write(d: Y.Doc, key: string, v: any) {
  d.transact(() => timersMap(d).set(key, v), LOCAL);
}

export function toggleClock(d: Y.Doc, key: TimerKey, fullMs: number) {
  const c = readClock(d, key);
  const now = serverNow();
  if (c && c.startedAt != null) {
    write(d, key, { remaining: c.remaining - (now - c.startedAt), startedAt: null });
  } else {
    let rem = c ? c.remaining : fullMs;
    if (key === 'speech' && rem <= 0) rem = fullMs;
    if (key !== 'speech' && rem <= 0) return;
    // starting prep pauses the other prep clock and the speech clock
    if (key !== 'speech') {
      for (const other of ['speech', key === 'prep-aff' ? 'prep-con' : 'prep-aff'] as TimerKey[]) {
        const o = readClock(d, other);
        if (o && o.startedAt != null) write(d, other, { remaining: o.remaining - (now - o.startedAt), startedAt: null });
      }
    } else {
      for (const other of ['prep-aff', 'prep-con'] as TimerKey[]) {
        const o = readClock(d, other);
        if (o && o.startedAt != null) write(d, other, { remaining: o.remaining - (now - o.startedAt), startedAt: null });
      }
    }
    write(d, key, { remaining: rem, startedAt: now });
  }
}

export function resetClock(d: Y.Doc, key: TimerKey, fullMs: number) {
  write(d, key, { remaining: fullMs, startedAt: null });
}

export function speechIndex(d: Y.Doc): number {
  return timersMap(d).get('speechIdx') ?? 0;
}
export function setSpeech(d: Y.Doc, idx: number, fullMs: number) {
  d.transact(() => {
    timersMap(d).set('speechIdx', idx);
    timersMap(d).set('speech', { remaining: fullMs, startedAt: null });
  }, LOCAL);
}

export function fmt(ms: number): string {
  const neg = ms < 0;
  const t = Math.ceil(Math.abs(ms) / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${neg ? '+' : ''}${m}:${String(s).padStart(2, '0')}`;
}
