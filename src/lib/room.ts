// Room "index" doc: the dashboard list of flows/templates and shared room settings.
import * as Y from 'yjs';
import { acquireDoc, destroyDocEverywhere, LOCAL, withDoc, type DocSync } from './sync';
import { copyFlowContent, initFlowDoc, meta, timersMap, type Mode } from './model';
import { newId } from './util';

export type DocKind = 'flow' | 'template';
export interface Entry {
  id: string;
  name: string;
  mode: Mode;
  kind: DocKind;
  createdAt: number;
  updatedAt: number;
}

export interface TimerSettings {
  C: number;
  R: number;
  S: number;
  F: number;
  CX: number;
  GCX: number;
  prep: number;
}
export const DEFAULT_TIMES: TimerSettings = { C: 240, R: 240, S: 180, F: 120, CX: 180, GCX: 180, prep: 180 };

export const INDEX_DOC = 'index';
export const entriesMap = (d: Y.Doc) => d.getMap<Y.Map<any>>('entries');
export const roomSettings = (d: Y.Doc) => d.getMap<any>('settings');

export function readEntries(d: Y.Doc): Entry[] {
  const out: Entry[] = [];
  entriesMap(d).forEach((m, id) => {
    out.push({
      id,
      name: m.get('name') ?? 'Untitled',
      mode: m.get('mode') ?? 'aff',
      kind: m.get('kind') ?? 'flow',
      createdAt: m.get('createdAt') ?? 0,
      updatedAt: m.get('updatedAt') ?? m.get('createdAt') ?? 0,
    });
  });
  return out;
}

export function readTimes(d: Y.Doc): TimerSettings {
  const s = roomSettings(d).get('times');
  return { ...DEFAULT_TIMES, ...(s || {}) };
}

let indexSync: { room: string; sync: DocSync } | null = null;
export function roomIndex(room: string): DocSync {
  if (indexSync?.room === room) return indexSync.sync;
  indexSync = { room, sync: acquireDoc(room, INDEX_DOC) };
  return indexSync.sync;
}

function putEntry(index: Y.Doc, e: Entry) {
  index.transact(() => {
    const m = new Y.Map<any>();
    for (const [k, v] of Object.entries(e)) if (k !== 'id') m.set(k, v);
    entriesMap(index).set(e.id, m);
  }, LOCAL);
}

export function updateEntry(index: Y.Doc, id: string, patch: Partial<Entry>) {
  const m = entriesMap(index).get(id);
  if (!m) return;
  index.transact(() => {
    for (const [k, v] of Object.entries(patch)) m.set(k, v);
  }, LOCAL);
}

export async function createDoc(
  room: string,
  opts: { name: string; mode: Mode; kind: DocKind; fromId?: string | null },
): Promise<string> {
  const index = roomIndex(room).doc;
  const id = newId();
  const now = Date.now();
  let mode = opts.mode;
  if (opts.fromId) {
    await withDoc(room, opts.fromId, async (src) => {
      await withDoc(room, id, (dst) => {
        copyFlowContent(src.doc, dst.doc, { name: opts.name, mode: opts.mode, kind: opts.kind });
      }, false);
    });
  } else {
    await withDoc(room, id, (dst) => initFlowDoc(dst.doc, opts.name, mode, opts.kind), false);
  }
  putEntry(index, { id, name: opts.name, mode, kind: opts.kind, createdAt: now, updatedAt: now });
  return id;
}

export async function duplicateDoc(room: string, srcId: string, name: string, kind: DocKind): Promise<string> {
  const index = roomIndex(room).doc;
  const src = entriesMap(index).get(srcId);
  return createDoc(room, { name, mode: src?.get('mode') ?? 'aff', kind, fromId: srcId });
}

export async function deleteDocEntry(room: string, id: string) {
  const index = roomIndex(room).doc;
  index.transact(() => entriesMap(index).delete(id), LOCAL);
  await destroyDocEverywhere(room, id);
}

/** Keep the index entry (name/mode/updatedAt) in step with a flow doc. */
export function bindEntry(room: string, id: string, flow: Y.Doc): () => void {
  const index = roomIndex(room).doc;
  let last = 0;
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL) return;
    const now = Date.now();
    if (now - last < 8000) return;
    last = now;
    updateEntry(index, id, { updatedAt: now });
  };
  const m = meta(flow);
  const onMeta = () => {
    const e = entriesMap(index).get(id);
    if (!e) return;
    const name = m.get('name');
    const mode = m.get('mode');
    if (name && e.get('name') !== name) updateEntry(index, id, { name });
    if (mode && e.get('mode') !== mode) updateEntry(index, id, { mode });
  };
  flow.on('update', onUpdate);
  m.observe(onMeta);
  void timersMap; // timers live in the flow doc
  return () => {
    flow.off('update', onUpdate);
    m.unobserve(onMeta);
  };
}

/** Rename from the dashboard: update both the index and the flow doc meta. */
export async function renameDoc(room: string, id: string, name: string) {
  const index = roomIndex(room).doc;
  updateEntry(index, id, { name, updatedAt: Date.now() });
  await withDoc(room, id, (s) => s.doc.transact(() => meta(s.doc).set('name', name), LOCAL));
}

// ---------- recent rooms (local) ----------
export const LAST_ROOM_KEY = 'pf.lastRoom';
export function rememberRoom(code: string) {
  try {
    localStorage.setItem(LAST_ROOM_KEY, code);
    const known = new Set<string>(JSON.parse(localStorage.getItem('pf.knownRooms') || '[]'));
    known.add(code);
    localStorage.setItem('pf.knownRooms', JSON.stringify([...known]));
  } catch {}
}
export function isKnownRoom(code: string) {
  try {
    return (JSON.parse(localStorage.getItem('pf.knownRooms') || '[]') as string[]).includes(code);
  } catch {
    return false;
  }
}
export function forgetLastRoom() {
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {}
}
