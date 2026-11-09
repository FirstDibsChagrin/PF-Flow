// Version history: activity log (who edited what), automatic + named snapshots, preview and restore.
//
// - activity: Y.Array in the flow doc. Each entry = one person's edits over ~5s:
//     { at, by, color, parts: [{ sheet, tab, cols: string[] }], other: string[] }
//   Consecutive entries by the same person within 2 minutes are merged. Bounded to MAX_ACTIVITY.
// - snapshots: clean (history-free) copies of the flow content, stored server-side
//   (table flow_snapshots, retention enforced by pf_save_snapshot). Offline saves queue locally.
import * as Y from 'yjs';
import { LOCAL, PROVISIONAL, SYSTEM } from './sync';
import { transport, type SnapshotMeta } from './transport';
import {
  addSheet,
  copyFlowContent,
  copySheetCells,
  levelOf,
  meta,
  nodesMap,
  sheetColumns,
  sheetOrder,
  sheetsMap,
  type Mode,
  type SheetKind,
} from './model';
import { fromBase64, toBase64 } from './util';

export const MAX_ACTIVITY = 300;
/** ~5 minutes; overridable via localStorage 'pf.autoSnapMs' for testing. */
export const AUTO_SNAPSHOT_MS = (() => {
  try {
    return Number(localStorage.getItem('pf.autoSnapMs')) || 5 * 60_000;
  } catch {
    return 5 * 60_000;
  }
})();

export interface ActivityPart {
  sheet: string;
  tab: string;
  cols: string[];
}
export interface ActivityEntry {
  at: number;
  by: string;
  color: string;
  parts: ActivityPart[];
  other: string[];
}

export const activityArray = (d: Y.Doc) => d.getArray<ActivityEntry>('activity');

/** Which flow area a changed Y type belongs to. */
function classify(d: Y.Doc, t: Y.AbstractType<any>): { node?: string; area?: string } {
  const nodes = nodesMap(d);
  // a node's `children` list changing means a child was added/removed: that child is recorded itself
  if ((t as any)._item?.parentSub === 'children') return {};
  let x: any = t;
  for (let i = 0; x && i < 6; i++) {
    const parent = x._item?.parent;
    if (parent === nodes) return { node: x._item.parentSub };
    if (x === d.getMap('round') || parent === d.getMap('round')) return { area: 'Round info' };
    if (x === d.getMap('ext') || parent === d.getMap('ext')) return { area: 'Extensions' };
    if (x === d.getMap('tracker') || parent === d.getMap('tracker')) return { area: 'Tracker' };
    x = parent;
  }
  if (t === d.getMap('round')) return { area: 'Round info' };
  if (t === d.getMap('ext')) return { area: 'Extensions' };
  if (t === d.getMap('tracker')) return { area: 'Tracker' };
  return {};
}

/** Records MY edits into the shared activity log (batched). */
export class ActivityRecorder {
  private pending = new Map<string, Set<string>>(); // sheet -> column labels
  private other = new Set<string>();
  private timer: any = null;
  dirtySince = 0; // last time I edited flow content (for auto-snapshots)

  constructor(private d: Y.Doc, private who: () => { name: string; color: string }, private fallbackSheet: () => string | null) {
    d.on('afterTransaction', this.onTx);
    window.addEventListener('pagehide', this.flush);
  }
  destroy() {
    this.flush();
    this.d.off('afterTransaction', this.onTx);
    window.removeEventListener('pagehide', this.flush);
  }

  private onTx = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL && tr.origin !== PROVISIONAL) return;
    const d = this.d;
    const nodes = nodesMap(d);
    let touched = false;
    const addNode = (id: string) => {
      const n = nodes.get(id);
      const sheet: string | undefined = n?.get('sheet') ?? this.fallbackSheet() ?? undefined;
      if (!sheet) return;
      const set = this.pending.get(sheet) ?? new Set<string>();
      if (n) {
        const s = sheetsMap(d).get(sheet);
        const cols = sheetColumns((s?.get('kind') as SheetKind) || 'extra', (meta(d).get('mode') as Mode) || 'aff');
        const col = cols[levelOf(d, id)];
        if (col) set.add(col.label);
      }
      this.pending.set(sheet, set);
      touched = true;
    };
    for (const [t, keys] of tr.changed) {
      const type = t as Y.AbstractType<any> as any;
      if (type === nodes) {
        keys.forEach((k) => k && addNode(k));
        continue;
      }
      if (type === sheetsMap(d) || type === sheetOrder(d)) {
        this.other.add('tabs');
        touched = true;
        continue;
      }
      if (type === meta(d)) {
        if (keys.has('mode')) this.other.add('speaking order');
        if (keys.has('name')) this.other.add('flow name');
        touched = touched || keys.has('mode');
        continue;
      }
      const c = classify(d, type);
      if (c.node) addNode(c.node);
      else if (c.area) {
        this.other.add(c.area);
        if (c.area !== 'Tracker') touched = true;
      } else if (type._item?.parent && sheetsMap(d).has((type as any)._item?.parentSub)) {
        this.other.add('tabs');
      }
    }
    if (touched) this.dirtySince = this.dirtySince || Date.now();
    if (!this.timer && (this.pending.size || this.other.size)) this.timer = setTimeout(this.flush, 5_000);
  };

  flush = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size && !this.other.size) return;
    const { name, color } = this.who();
    const d = this.d;
    const parts: ActivityPart[] = [...this.pending].map(([sheet, cols]) => ({
      sheet,
      tab: sheetsMap(d).get(sheet)?.get('name') ?? 'a deleted tab',
      cols: [...cols],
    }));
    const entry: ActivityEntry = { at: Date.now(), by: name || 'Someone', color, parts, other: [...this.other] };
    this.pending.clear();
    this.other.clear();
    const arr = activityArray(d);
    d.transact(() => {
      const last = arr.length ? arr.get(arr.length - 1) : null;
      if (last && last.by === entry.by && entry.at - last.at < 120_000) {
        arr.delete(arr.length - 1, 1);
        arr.push([mergeEntries(last, entry)]);
      } else arr.push([entry]);
      if (arr.length > MAX_ACTIVITY) arr.delete(0, arr.length - MAX_ACTIVITY + 50);
    }, SYSTEM);
  };
}

export function mergeEntries(a: ActivityEntry, b: ActivityEntry): ActivityEntry {
  const parts = new Map<string, ActivityPart>();
  for (const p of [...a.parts, ...b.parts]) {
    const cur = parts.get(p.sheet);
    if (cur) parts.set(p.sheet, { sheet: p.sheet, tab: p.tab, cols: [...new Set([...cur.cols, ...p.cols])] });
    else parts.set(p.sheet, { ...p, cols: [...p.cols] });
  }
  return { at: b.at, by: b.by, color: b.color, parts: [...parts.values()], other: [...new Set([...a.other, ...b.other])] };
}

/** "Alex edited Aff tab (Con Rebuttal, Aff Summary); Bea edited Con tab" */
export function describeActivity(entries: ActivityEntry[]): string {
  const byPerson = new Map<string, ActivityEntry>();
  for (const e of entries) {
    const cur = byPerson.get(e.by);
    byPerson.set(e.by, cur ? mergeEntries(cur, e) : e);
  }
  const out: string[] = [];
  for (const [by, e] of byPerson) {
    const bits = e.parts.map((p) => `${p.tab} tab${p.cols.length ? ` (${p.cols.slice(0, 3).join(', ')}${p.cols.length > 3 ? '…' : ''})` : ''}`);
    bits.push(...e.other);
    if (bits.length) out.push(`${by} edited ${bits.join(', ')}`);
  }
  return out.join('; ');
}

export function activitySince(d: Y.Doc, since: number): ActivityEntry[] {
  return activityArray(d)
    .toArray()
    .filter((e) => e.at >= since);
}

// ---------- snapshots ----------
/** History-free copy of the flow's content (keeps tab ids so "Restore this tab" can match). */
export function snapshotData(d: Y.Doc): string {
  const tmp = new Y.Doc();
  copyFlowContent(d, tmp, { name: meta(d).get('name') ?? '', mode: meta(d).get('mode'), kind: 'flow', keepSheetIds: true, extra: false });
  const out = toBase64(Y.encodeStateAsUpdateV2(tmp));
  tmp.destroy();
  return out;
}
export function loadSnapshot(data: string): Y.Doc {
  const d = new Y.Doc();
  Y.applyUpdateV2(d, fromBase64(data));
  return d;
}

const PENDING = 'pf.pendingSnaps';
type Pending = { room: string; name: string | null; kind: 'auto' | 'manual'; by: string; summary: string; data: string; at: number };
function readPending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING) || '[]');
  } catch {
    return [];
  }
}
function writePending(xs: Pending[]) {
  // keep it small: newest manual ones first, at most 6
  const keep = [...xs.filter((x) => x.kind === 'manual'), ...xs.filter((x) => x.kind === 'auto')].slice(0, 6);
  try {
    localStorage.setItem(PENDING, JSON.stringify(keep));
  } catch {}
}
export function pendingSnapshots(room: string) {
  return readPending().filter((p) => p.room === room);
}
export async function flushPendingSnapshots() {
  const xs = readPending();
  if (!xs.length || !navigator.onLine) return;
  const left: Pending[] = [];
  for (const p of xs) {
    try {
      await transport.saveSnapshot(p.room, { name: p.name, kind: p.kind, by: p.by, summary: p.summary, data: p.data });
    } catch {
      left.push(p);
    }
  }
  writePending(left);
}

const lastSnapKey = (room: string) => `pf.lastSnap.${room}`;
export function lastSnapshotAt(room: string): number {
  return Number(localStorage.getItem(lastSnapKey(room)) || 0);
}

/** Save a snapshot now (queues locally when offline). Returns true if stored or queued. */
export async function saveSnapshot(room: string, d: Y.Doc, opts: { name: string | null; kind: 'auto' | 'manual'; by: string }): Promise<'saved' | 'queued' | 'skipped'> {
  const since = lastSnapshotAt(room) || Date.now() - AUTO_SNAPSHOT_MS;
  const summary = describeActivity(activitySince(d, since)) || (opts.kind === 'manual' ? `${opts.by} saved this version` : '');
  const input = { name: opts.name, kind: opts.kind, by: opts.by, summary, data: snapshotData(d) };
  try {
    const id = await transport.saveSnapshot(room, input);
    if (id == null) return 'skipped';
    localStorage.setItem(lastSnapKey(room), String(Date.now()));
    return 'saved';
  } catch {
    writePending([{ room, ...input, at: Date.now() }, ...readPending()]);
    localStorage.setItem(lastSnapKey(room), String(Date.now()));
    return 'queued';
  }
}

export type { SnapshotMeta };

// ---------- restore ----------
export interface RestoreNotice {
  by: string;
  client: string;
  at: number;
  text: string;
}

/** Replace one tab with its content from a snapshot (as a normal, synced, undoable edit). */
export function restoreSheet(live: Y.Doc, snap: Y.Doc, sheetId: string) {
  const ss = sheetsMap(snap).get(sheetId);
  if (!ss) return;
  live.transact(() => {
    let ls = sheetsMap(live).get(sheetId);
    if (!ls) {
      addSheet(live, ss.get('name'), ss.get('kind'), undefined, false, sheetId);
      ls = sheetsMap(live).get(sheetId)!;
    }
    ls.set('name', ss.get('name'));
    ls.set('hidden', [...(ss.get('hidden') || [])]);
    copySheetCells(snap, sheetId, live, sheetId);
  }, LOCAL);
}

/** Replace all tabs (content, order, speaking order) with a snapshot's. Round info, chat, extensions are kept. */
export function restoreFlow(live: Y.Doc, snap: Y.Doc) {
  live.transact(() => {
    const keep = new Set(sheetOrder(snap).toArray());
    for (const sid of [...sheetsMap(live).keys()]) {
      if (keep.has(sid)) continue;
      const nodes = nodesMap(live);
      const doomed: string[] = [];
      nodes.forEach((n, id) => {
        if (n.get('sheet') === sid) doomed.push(id);
      });
      doomed.forEach((id) => nodes.delete(id));
      sheetsMap(live).delete(sid);
    }
    for (const sid of sheetOrder(snap).toArray()) restoreSheet(live, snap, sid);
    const order = sheetOrder(live);
    order.delete(0, order.length);
    order.push(sheetOrder(snap).toArray().filter((s) => sheetsMap(live).has(s)));
    const mode = meta(snap).get('mode');
    if (mode) meta(live).set('mode', mode);
  }, LOCAL);
}

export function postRestoreNotice(live: Y.Doc, n: RestoreNotice) {
  live.transact(() => meta(live).set('restoreNotice', n), SYSTEM);
}
