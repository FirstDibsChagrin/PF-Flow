// Flow document schema (one Y.Doc per flow or template) and editing operations.
//
// meta: Y.Map { name, mode: 'aff'|'con' (who speaks first), kind: 'flow'|'template', createdAt }
// sheetOrder: Y.Array<sheetId>
// sheets: Y.Map<sheetId, Y.Map { name, kind: 'aff'|'con'|'extra', children: Y.Array<nodeId>, hidden: SpeechKey[] }>
// nodes: Y.Map<nodeId, Y.Map { text: Y.Text, children: Y.Array<nodeId>, parent: string, sheet: string,
//                              mark?: Mark, bold?, crossed?, empty?, ext? }>
// timers: Y.Map (see timers.ts)
//
// Cells form a tree (exactly like Flower): a cell's children are the responses to it in the next
// column, so responses always line up in the same row as the argument they answer.
import * as Y from 'yjs';
import { LOCAL } from './sync';
import { newId } from './util';

export type Side = 'aff' | 'con';
export type Mode = Side; // which side speaks first
export type SheetKind = 'aff' | 'con' | 'extra';
export type Mark = 'dropped' | 'extended' | 'turned';
export type SpeechKey = 'C1' | 'C2' | 'R1' | 'R2' | 'S1' | 'S2' | 'F1' | 'F2'; // 1 = first team

export const SPEECH_NAMES: Record<string, string> = { C: 'Constructive', R: 'Rebuttal', S: 'Summary', F: 'Final Focus' };
export const SPEECH_SHORT: Record<string, string> = { C: 'C', R: 'R', S: 'S', F: 'FF' };
export const ALL_SPEECHES: SpeechKey[] = ['C1', 'C2', 'R1', 'R2', 'S1', 'S2', 'F1', 'F2'];

export interface Column {
  key: SpeechKey;
  side: Side;
  label: string; // "Aff Constructive"
  short: string; // "AC"
}

export const otherSide = (s: Side): Side => (s === 'aff' ? 'con' : 'aff');
export const sideName = (s: Side) => (s === 'aff' ? 'Aff' : 'Con');

export function speechSide(key: SpeechKey, mode: Mode): Side {
  return key[1] === '1' ? mode : otherSide(mode);
}

export function makeColumn(key: SpeechKey, mode: Mode): Column {
  const side = speechSide(key, mode);
  return {
    key,
    side,
    label: `${sideName(side)} ${SPEECH_NAMES[key[0]]}`,
    short: `${side === 'aff' ? 'A' : 'N'}${SPEECH_SHORT[key[0]]}`,
  };
}

export function sheetSpeeches(kind: SheetKind, mode: Mode): SpeechKey[] {
  if (kind === 'extra') return ALL_SPEECHES;
  const isFirst = kind === mode;
  return isFirst ? ['C1', 'R2', 'S1', 'S2', 'F1', 'F2'] : ['C2', 'R1', 'R2', 'S1', 'S2', 'F1', 'F2'];
}

export function sheetColumns(kind: SheetKind, mode: Mode): Column[] {
  return sheetSpeeches(kind, mode).map((k) => makeColumn(k, mode));
}

// ---------- accessors ----------
export const meta = (d: Y.Doc) => d.getMap<any>('meta');
export const sheetOrder = (d: Y.Doc) => d.getArray<string>('sheetOrder');
export const sheetsMap = (d: Y.Doc) => d.getMap<Y.Map<any>>('sheets');
export const nodesMap = (d: Y.Doc) => d.getMap<Y.Map<any>>('nodes');
export const timersMap = (d: Y.Doc) => d.getMap<any>('timers');

export const ROOT = 'root:'; // parent id prefix for top-level cells
export const rootOf = (sheetId: string) => ROOT + sheetId;

export function getNode(d: Y.Doc, id: string | null | undefined) {
  return id ? nodesMap(d).get(id) : undefined;
}
export function childrenOf(d: Y.Doc, parentId: string): Y.Array<string> | undefined {
  if (parentId.startsWith(ROOT)) return sheetsMap(d).get(parentId.slice(ROOT.length))?.get('children');
  return nodesMap(d).get(parentId)?.get('children');
}
export function liveChildren(d: Y.Doc, parentId: string): string[] {
  const arr = childrenOf(d, parentId);
  if (!arr) return [];
  const nodes = nodesMap(d);
  return arr.toArray().filter((id) => nodes.has(id));
}

export function levelOf(d: Y.Doc, id: string): number {
  let lvl = 0;
  let cur = getNode(d, id);
  while (cur) {
    const p: string = cur.get('parent');
    if (!p || p.startsWith(ROOT)) return lvl;
    lvl++;
    cur = getNode(d, p);
    if (lvl > 50) break;
  }
  return lvl;
}

// ---------- creation ----------
function makeNode(parent: string, sheet: string, text = '', extra: Record<string, any> = {}) {
  const m = new Y.Map<any>();
  const t = new Y.Text();
  if (text) t.insert(0, text);
  m.set('text', t);
  m.set('children', new Y.Array<string>());
  m.set('parent', parent);
  m.set('sheet', sheet);
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
}

export function txn<T>(d: Y.Doc, fn: () => T): T {
  let r!: T;
  d.transact(() => {
    r = fn();
  }, LOCAL);
  return r;
}

export function addSheet(d: Y.Doc, name: string, kind: SheetKind, index?: number, withCell = true, fixedId?: string): string {
  const id = fixedId ?? newId();
  const s = new Y.Map<any>();
  s.set('name', name);
  s.set('kind', kind);
  s.set('children', new Y.Array<string>());
  s.set('hidden', []);
  sheetsMap(d).set(id, s);
  const order = sheetOrder(d);
  order.insert(index ?? order.length, [id]);
  if (withCell) {
    const nid = newId();
    nodesMap(d).set(nid, makeNode(rootOf(id), id));
    s.get('children').push([nid]);
  }
  return id;
}

export function initFlowDoc(d: Y.Doc, name: string, mode: Mode, kind: 'flow' | 'template') {
  txn(d, () => {
    const m = meta(d);
    m.set('name', name);
    m.set('mode', mode);
    m.set('kind', kind);
    m.set('createdAt', Date.now());
    addSheet(d, 'Aff', 'aff');
    addSheet(d, 'Con', 'con');
  });
}

export function deleteSheet(d: Y.Doc, sheetId: string) {
  txn(d, () => {
    const order = sheetOrder(d);
    const i = order.toArray().indexOf(sheetId);
    if (i >= 0) order.delete(i, 1);
    const nodes = nodesMap(d);
    const doomed: string[] = [];
    nodes.forEach((n, id) => {
      if (n.get('sheet') === sheetId) doomed.push(id);
    });
    doomed.forEach((id) => nodes.delete(id));
    sheetsMap(d).delete(sheetId);
  });
}

export function moveSheet(d: Y.Doc, sheetId: string, to: number) {
  txn(d, () => {
    const order = sheetOrder(d);
    const arr = order.toArray();
    const from = arr.indexOf(sheetId);
    if (from < 0) return;
    order.delete(from, 1);
    order.insert(Math.max(0, Math.min(to, order.length)), [sheetId]);
  });
}

/** Insert a new cell under parentId at index. Returns its id. */
export function insertCell(d: Y.Doc, parentId: string, index: number, extra: Record<string, any> = {}, text = ''): string {
  const parentSheet = parentId.startsWith(ROOT) ? parentId.slice(ROOT.length) : getNode(d, parentId)?.get('sheet');
  const id = newId();
  txn(d, () => {
    nodesMap(d).set(id, makeNode(parentId, parentSheet, text, extra));
    const arr = childrenOf(d, parentId)!;
    arr.insert(Math.max(0, Math.min(index, arr.length)), [id]);
  });
  return id;
}

/** Index within the raw Y.Array (which may contain stale ids) for a live index position. */
function rawIndex(d: Y.Doc, parentId: string, id: string): number {
  return childrenOf(d, parentId)?.toArray().indexOf(id) ?? -1;
}

export function deleteCell(d: Y.Doc, id: string) {
  const n = getNode(d, id);
  if (!n) return;
  txn(d, () => {
    const parent: string = n.get('parent');
    const arr = childrenOf(d, parent);
    const i = rawIndex(d, parent, id);
    if (arr && i >= 0) arr.delete(i, 1);
    const nodes = nodesMap(d);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const cn = nodes.get(cur);
      if (cn) stack.push(...(cn.get('children') as Y.Array<string>).toArray());
      nodes.delete(cur);
    }
  });
}

export function setCellProp(d: Y.Doc, id: string, key: string, value: any) {
  const n = getNode(d, id);
  if (!n) return;
  txn(d, () => {
    if (value === undefined || value === null || value === false) n.delete(key);
    else n.set(key, value);
  });
}

export function setText(d: Y.Doc, ytext: Y.Text, next: string) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endP = prev.length;
  let endN = next.length;
  while (endP > start && endN > start && prev[endP - 1] === next[endN - 1]) {
    endP--;
    endN--;
  }
  d.transact(() => {
    if (endP > start) ytext.delete(start, endP - start);
    if (endN > start) ytext.insert(start, next.slice(start, endN));
  }, LOCAL);
}

/** Deep-copy a whole flow document's content into another (used for templates & duplicate). */
/** Copy a sheet's cells (with fresh cell ids) from src into dst's sheet `dstSheet`, replacing what's there. */
export function copySheetCells(src: Y.Doc, srcSheet: string, dst: Y.Doc, dstSheet: string, includeCalls = true) {
  const sNodes = nodesMap(src);
  const dNodes = nodesMap(dst);
  const ds = sheetsMap(dst).get(dstSheet)!;
  // clear the destination sheet
  const doomed: string[] = [];
  dNodes.forEach((n, id) => {
    if (n.get('sheet') === dstSheet) doomed.push(id);
  });
  doomed.forEach((id) => dNodes.delete(id));
  const dKids = ds.get('children') as Y.Array<string>;
  if (dKids.length) dKids.delete(0, dKids.length);
  const copyNode = (oldId: string, newParent: string): string | null => {
    const n = sNodes.get(oldId);
    if (!n) return null;
    const id = newId();
    const extra: Record<string, any> = {};
    for (const k of ['mark', 'bold', 'crossed', 'empty', 'ext']) if (n.get(k)) extra[k] = n.get(k);
    // evidence calls belong to one round: kept for snapshots/restore/duplicate, never for templates
    if (includeCalls && n.get('call')) {
      extra.call = n.get('call');
      const note = new Y.Text();
      const old = n.get('callNote');
      if (old instanceof Y.Text && old.length) note.insert(0, old.toString());
      extra.callNote = note;
    }
    const nn = makeNode(newParent, dstSheet, (n.get('text') as Y.Text).toString(), extra);
    dNodes.set(id, nn);
    const kids: string[] = [];
    for (const c of (n.get('children') as Y.Array<string>).toArray()) {
      const nc = copyNode(c, id);
      if (nc) kids.push(nc);
    }
    (nn.get('children') as Y.Array<string>).push(kids);
    return id;
  };
  const kids: string[] = [];
  for (const c of ((sheetsMap(src).get(srcSheet)?.get('children') as Y.Array<string>) ?? new Y.Array<string>()).toArray()) {
    const nc = copyNode(c, rootOf(dstSheet));
    if (nc) kids.push(nc);
  }
  dKids.push(kids);
}

/** Hooks so other modules (extensions, …) can copy their parts of a flow along with it. */
export const contentCopiers: ((src: Y.Doc, dst: Y.Doc) => void)[] = [];

/** Deep-copy a whole flow document's content into another (templates, duplicate, snapshots). */
export function copyFlowContent(
  src: Y.Doc,
  dst: Y.Doc,
  opts: { name: string; mode?: Mode; kind: 'flow' | 'template'; keepSheetIds?: boolean; extra?: boolean },
) {
  const srcMode: Mode = meta(src).get('mode') || 'aff';
  // Call-evidence marks never go into a template, nor from a template into a new flow.
  const includeCalls = opts.kind === 'flow' && (meta(src).get('kind') ?? 'flow') !== 'template';
  dst.transact(() => {
    const m = meta(dst);
    m.set('name', opts.name);
    m.set('mode', opts.mode ?? srcMode);
    m.set('kind', opts.kind);
    m.set('createdAt', Date.now());
    if (opts.kind === 'template') m.set('sourceMode', srcMode);
    for (const sid of sheetOrder(src).toArray()) {
      const s = sheetsMap(src).get(sid);
      if (!s || sheetsMap(dst).has(sid) && opts.keepSheetIds) continue;
      const nsid = addSheet(dst, s.get('name'), s.get('kind'), undefined, false, opts.keepSheetIds ? sid : undefined);
      sheetsMap(dst).get(nsid)!.set('hidden', [...(s.get('hidden') || [])]);
      copySheetCells(src, sid, dst, nsid, includeCalls);
    }
    if (opts.extra !== false) for (const f of contentCopiers) f(src, dst);
  }, LOCAL);
}

/** How many cells would be pushed past the last column if the flow switched to `mode`. */
export function cellsBeyondColumns(d: Y.Doc, mode: Mode): number {
  let count = 0;
  const nodes = nodesMap(d);
  const sheets = sheetsMap(d);
  nodes.forEach((n, id) => {
    const s = sheets.get(n.get('sheet'));
    if (!s) return;
    const cols = sheetSpeeches(s.get('kind'), mode).length;
    if (levelOf(d, id) >= cols && (n.get('text') as Y.Text).length > 0) count++;
  });
  return count;
}
