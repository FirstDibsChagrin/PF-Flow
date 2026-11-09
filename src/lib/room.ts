// Personal "home" (your dashboard) + per-flow share codes.
//
// Storage layout (each (room, doc) pair is one Yjs document; see sync.ts):
//   (homeCode, 'index')      -> your dashboard: list of flows + templates, default timer lengths
//   (homeCode, templateId)   -> a template (templates are personal)
//   (flowCode, 'flow')       -> a flow. The flow code is what you give your partner: it unlocks
//                               exactly that flow and nothing else in your home.
// Home codes and flow codes are both rows in the `rooms` table; the code is the only key.
import * as Y from 'yjs';
import { acquireDoc, destroyDocEverywhere, LOCAL, withDoc, type DocSync } from './sync';
import { copyFlowContent, initFlowDoc, meta, sheetOrder, timersMap, type Mode } from './model';
import { transport } from './transport';
import { fromBase64, isValidRoomCode, newId, newRoomCode } from './util';
import { EMPTY_SUMMARY, readSummary, roundMap, type RoundSummary } from './round';

export type DocKind = 'flow' | 'template';
export interface Entry {
  id: string; // flow code (flows) or template id
  name: string;
  mode: Mode;
  kind: DocKind;
  createdAt: number;
  updatedAt: number;
  code?: string; // flows: share code where the flow lives
  joined?: boolean; // flows: joined from a partner's code (you didn't create it)
  round: RoundSummary; // flows: snapshot of Round info for cards, filters and search
}
export interface Loc {
  room: string;
  doc: string;
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
export const FLOW_DOC = 'flow';
export const entriesMap = (d: Y.Doc) => d.getMap<Y.Map<any>>('entries');
export const roomSettings = (d: Y.Doc) => d.getMap<any>('settings');

// ---------- home ----------
const HOME_KEY = 'pf.home';
const PENDING_KEY = 'pf.pendingRooms';

function readPending(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  } catch {
    return [];
  }
}
function writePending(xs: string[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(xs));
  } catch {}
}

/** Register a locally generated code on the server (now, or later if offline). */
async function registerRoom(code: string): Promise<void> {
  try {
    await transport.createRoom(code); // false = already exists, which is fine
    writePending(readPending().filter((c) => c !== code));
  } catch {
    if (!readPending().includes(code)) writePending([...readPending(), code]);
  }
}
/** Retry registering codes that were created offline. */
export async function flushPendingRooms() {
  for (const c of readPending()) await registerRoom(c);
}

let cachedHome: string | null = null;
export function homeCode(): string {
  if (cachedHome) return cachedHome;
  let code: string | null = null;
  try {
    // v1 used shared rooms: adopt the last room (or an old /r/CODE link) as this device's home
    const legacyLink = location.pathname.match(/^\/r\/([A-HJKMNP-Z2-9]{8})/)?.[1];
    code = localStorage.getItem(HOME_KEY) || localStorage.getItem('pf.lastRoom') || legacyLink || null;
  } catch {}
  if (!code || !isValidRoomCode(code)) {
    code = newRoomCode();
    registerRoom(code);
  }
  try {
    localStorage.setItem(HOME_KEY, code);
  } catch {}
  cachedHome = code;
  return code;
}

/** Switch this device to another home (e.g. your home from another computer). */
export function setHome(code: string) {
  localStorage.setItem(HOME_KEY, code);
  location.href = '/';
}

let indexSync: DocSync | null = null;
export function homeIndex(): DocSync {
  if (!indexSync) indexSync = acquireDoc(homeCode(), INDEX_DOC);
  return indexSync;
}

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
      code: m.get('code'),
      joined: m.get('joined'),
      round: { ...EMPTY_SUMMARY, ...(m.get('round') || {}) },
    });
  });
  return out;
}

export function readDefaultTimes(index: Y.Doc): TimerSettings {
  return { ...DEFAULT_TIMES, ...(roomSettings(index).get('times') || {}) };
}
/** A flow's timer lengths travel with the flow, so both partners use the same ones. */
export function readFlowTimes(flow: Y.Doc): TimerSettings {
  return { ...DEFAULT_TIMES, ...(timersMap(flow).get('lengths') || {}) };
}

/** Where a dashboard entry's document lives. */
export function locOf(e: Pick<Entry, 'id' | 'kind' | 'code'>): Loc {
  if (e.kind === 'flow' && e.code) return { room: e.code, doc: FLOW_DOC };
  return { room: homeCode(), doc: e.id }; // templates, and flows from before share codes existed
}
export const flowLoc = (code: string): Loc => ({ room: code, doc: FLOW_DOC });

function putEntry(e: Entry) {
  const index = homeIndex().doc;
  index.transact(() => {
    const m = new Y.Map<any>();
    for (const [k, v] of Object.entries(e)) if (k !== 'id' && v !== undefined) m.set(k, v);
    entriesMap(index).set(e.id, m);
  }, LOCAL);
}

export function updateEntry(id: string, patch: Partial<Entry>) {
  const index = homeIndex().doc;
  const m = entriesMap(index).get(id);
  if (!m) return;
  index.transact(() => {
    for (const [k, v] of Object.entries(patch)) m.set(k, v);
  }, LOCAL);
}

// ---------- create / copy ----------
async function fill(dst: Loc, opts: { name: string; mode: Mode; kind: DocKind; from?: Loc | null }) {
  const write = (d: Y.Doc, src?: Y.Doc) => {
    if (src) copyFlowContent(src, d, { name: opts.name, mode: opts.mode, kind: opts.kind });
    else initFlowDoc(d, opts.name, opts.mode, opts.kind);
    if (opts.kind === 'flow') {
      const lengths = readDefaultTimes(homeIndex().doc);
      d.transact(() => timersMap(d).set('lengths', lengths), LOCAL);
    }
  };
  if (opts.from) {
    const from = opts.from;
    await withDoc(from.room, from.doc, (src) => withDoc(dst.room, dst.doc, (d) => write(d.doc, src.doc), false));
  } else {
    await withDoc(dst.room, dst.doc, (d) => write(d.doc), false);
  }
}

/** Create a new flow with its own share code. Returns the code. */
export async function createFlow(opts: { name: string; mode: Mode; from?: Loc | null }): Promise<string> {
  const code = newRoomCode();
  await registerRoom(code);
  await fill(flowLoc(code), { ...opts, kind: 'flow' });
  const now = Date.now();
  putEntry({ id: code, code, name: opts.name, mode: opts.mode, kind: 'flow', createdAt: now, updatedAt: now, round: EMPTY_SUMMARY });
  return code;
}

export async function createTemplate(opts: { name: string; mode: Mode; from?: Loc | null }): Promise<string> {
  const id = newId();
  await fill({ room: homeCode(), doc: id }, { ...opts, kind: 'template' });
  const now = Date.now();
  putEntry({ id, name: opts.name, mode: opts.mode, kind: 'template', createdAt: now, updatedAt: now, round: EMPTY_SUMMARY });
  return id;
}

export async function duplicateEntry(e: Entry): Promise<string> {
  const name = `${e.name} (copy)`;
  return e.kind === 'flow' ? createFlow({ name, mode: e.mode, from: locOf(e) }) : createTemplate({ name, mode: e.mode, from: locOf(e) });
}

/** Flows made before share codes existed live inside the home; give them their own code. */
export async function ensureFlowCode(e: Entry): Promise<string> {
  if (e.code) return e.code;
  const code = newRoomCode();
  await registerRoom(code);
  await fill(flowLoc(code), { name: e.name, mode: e.mode, kind: 'flow', from: locOf(e) });
  const old = locOf(e);
  const index = homeIndex().doc;
  index.transact(() => entriesMap(index).delete(e.id), LOCAL);
  putEntry({ ...e, id: code, code });
  destroyDocEverywhere(old.room, old.doc);
  return code;
}

// ---------- join ----------
export type JoinResult = { ok: true; code: string } | { ok: false; error: string };

/** Add a partner's flow to your dashboard. Requires a connection the first time. */
export async function joinFlow(raw: string): Promise<JoinResult> {
  const code = raw.toUpperCase();
  if (!isValidRoomCode(code)) return { ok: false, error: 'Flow codes are 8 characters, like K7QM2XPA.' };
  if (code === homeCode()) return { ok: false, error: "That's your own home code, not a flow code." };
  if (entriesMap(homeIndex().doc).has(code)) return { ok: true, code };
  try {
    if (!(await transport.roomExists(code))) return { ok: false, error: 'No flow with that code.' };
  } catch {
    return { ok: false, error: "You're offline. Joining a flow needs a connection the first time." };
  }
  const info = await withDoc(code, FLOW_DOC, (s) => ({
    name: meta(s.doc).get('name') as string | undefined,
    mode: (meta(s.doc).get('mode') as Mode) || 'aff',
    createdAt: (meta(s.doc).get('createdAt') as number) || Date.now(),
    sheets: sheetOrder(s.doc).length,
    round: readSummary(s.doc),
  }));
  if (!info.name && !info.sheets) return { ok: false, error: 'No flow with that code.' };
  putEntry({ id: code, code, name: info.name || 'Shared flow', mode: info.mode, kind: 'flow', createdAt: info.createdAt, updatedAt: Date.now(), joined: true, round: info.round });
  return { ok: true, code };
}

/** Opening a flow link directly also adds it to your dashboard. */
export function rememberFlow(code: string, flow: Y.Doc) {
  if (entriesMap(homeIndex().doc).has(code)) return;
  const m = meta(flow);
  if (!m.get('name')) return;
  putEntry({ id: code, code, name: m.get('name'), mode: m.get('mode') || 'aff', kind: 'flow', createdAt: m.get('createdAt') || Date.now(), updatedAt: Date.now(), joined: true, round: readSummary(flow) });
}

// ---------- delete / rename ----------
/** Remove from your dashboard. Flows you created (and templates) are also deleted from the server. */
export async function deleteEntry(e: Entry) {
  const index = homeIndex().doc;
  index.transact(() => entriesMap(index).delete(e.id), LOCAL);
  const loc = locOf(e);
  if (e.kind === 'template' || !e.joined) await destroyDocEverywhere(loc.room, loc.doc);
}

export async function renameEntry(e: Entry, name: string) {
  updateEntry(e.id, { name, updatedAt: Date.now() });
  const loc = locOf(e);
  await withDoc(loc.room, loc.doc, (s) => s.doc.transact(() => meta(s.doc).set('name', name), LOCAL));
}

/** Keep the dashboard entry (name/mode/updatedAt) in step with an open flow or template. */
export function bindEntry(id: string, flow: Y.Doc): () => void {
  let last = 0;
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL) return;
    const now = Date.now();
    if (now - last < 8000) return;
    last = now;
    updateEntry(id, { updatedAt: now });
  };
  const m = meta(flow);
  const onMeta = () => {
    const e = entriesMap(homeIndex().doc).get(id);
    if (!e) return;
    const name = m.get('name');
    const mode = m.get('mode');
    if (name && e.get('name') !== name) updateEntry(id, { name });
    if (mode && e.get('mode') !== mode) updateEntry(id, { mode });
  };
  const rm = roundMap(flow);
  let roundTimer: any = null;
  const onRound = () => {
    if (roundTimer) return;
    roundTimer = setTimeout(() => {
      roundTimer = null;
      mirrorRound(id, readSummary(flow));
    }, 600);
  };
  flow.on('update', onUpdate);
  m.observe(onMeta);
  rm.observeDeep(onRound);
  onMeta();
  onRound();
  return () => {
    flow.off('update', onUpdate);
    m.unobserve(onMeta);
    rm.unobserveDeep(onRound);
    if (roundTimer) {
      clearTimeout(roundTimer);
      mirrorRound(id, readSummary(flow));
    }
  };
}

function mirrorRound(id: string, sum: RoundSummary) {
  const e = entriesMap(homeIndex().doc).get(id);
  if (!e) return;
  const prev = { ...EMPTY_SUMMARY, ...(e.get('round') || {}) };
  if (JSON.stringify(prev) !== JSON.stringify(sum)) updateEntry(id, { round: sum });
}

/**
 * Refresh dashboard cards from the server copy of each flow, so Round info your partner edited
 * shows up without you opening the flow. Fetches only; doesn't join live channels.
 */
const lastPeek = new Map<string, number>();
export async function refreshFlowSummaries(entries: Entry[]) {
  if (!navigator.onLine || transport.kind !== 'supabase') return;
  const todo = entries.filter((e) => e.kind === 'flow' && e.code && Date.now() - (lastPeek.get(e.id) ?? 0) > 60_000);
  const work = async (e: Entry) => {
    lastPeek.set(e.id, Date.now());
    try {
      const rows = await transport.getUpdates(e.code!, FLOW_DOC, 0);
      if (!rows.length) return;
      const d = new Y.Doc();
      for (const r of rows) Y.applyUpdate(d, fromBase64(r.update));
      const name = meta(d).get('name');
      const mode = meta(d).get('mode');
      if (name && name !== e.name) updateEntry(e.id, { name });
      if (mode && mode !== e.mode) updateEntry(e.id, { mode });
      mirrorRound(e.id, readSummary(d));
      d.destroy();
    } catch {
      /* offline or flaky: keep the cached card */
    }
  };
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(work));
}
