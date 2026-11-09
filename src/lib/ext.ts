// Prewritten extensions (read aloud in Summary / Final Focus), stored in the flow or template doc.
//
// ext: Y.Map {
//   items: Y.Map<id, Y.Map { title: Y.Text, summary: Y.Text, ff: Y.Text }>
//   affOrder / conOrder: Y.Array<id>        (order kept separately so reordering never clones text)
// }
import * as Y from 'yjs';
import { contentCopiers, meta, type Side } from './model';
import { LOCAL, SYSTEM } from './sync';
import { newId } from './util';

export type ExtField = 'title' | 'summary' | 'ff';
export const extRoot = (d: Y.Doc) => d.getMap<any>('ext');

export function ensureExt(d: Y.Doc) {
  const r = extRoot(d);
  if (r.get('items') instanceof Y.Map && r.get('affOrder') instanceof Y.Array && r.get('conOrder') instanceof Y.Array) return;
  d.transact(() => {
    if (!(r.get('items') instanceof Y.Map)) r.set('items', new Y.Map());
    if (!(r.get('affOrder') instanceof Y.Array)) r.set('affOrder', new Y.Array());
    if (!(r.get('conOrder') instanceof Y.Array)) r.set('conOrder', new Y.Array());
  }, SYSTEM);
}
export const extItems = (d: Y.Doc) => extRoot(d).get('items') as Y.Map<Y.Map<any>> | undefined;
export const extOrder = (d: Y.Doc, side: Side) => extRoot(d).get(side === 'aff' ? 'affOrder' : 'conOrder') as Y.Array<string> | undefined;

export function listExt(d: Y.Doc, side: Side): string[] {
  const items = extItems(d);
  const order = extOrder(d, side);
  if (!items || !order) return [];
  return order.toArray().filter((id, i, a) => items.has(id) && a.indexOf(id) === i);
}

function makeItem(title = '', summary = '', ff = '') {
  const m = new Y.Map<any>();
  for (const [k, v] of [
    ['title', title],
    ['summary', summary],
    ['ff', ff],
  ] as const) {
    const t = new Y.Text();
    if (v) t.insert(0, v);
    m.set(k, t);
  }
  return m;
}

export function addExt(d: Y.Doc, side: Side, at?: number): string {
  ensureExt(d);
  const id = newId();
  d.transact(() => {
    extItems(d)!.set(id, makeItem());
    const order = extOrder(d, side)!;
    order.insert(at ?? order.length, [id]);
  }, LOCAL);
  return id;
}

export function deleteExt(d: Y.Doc, side: Side, id: string) {
  d.transact(() => {
    const order = extOrder(d, side);
    const arr = order?.toArray() ?? [];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === id) order!.delete(i, 1);
    extItems(d)?.delete(id);
  }, LOCAL);
}

export function moveExt(d: Y.Doc, side: Side, id: string, dir: -1 | 1) {
  const visible = listExt(d, side);
  const i = visible.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return;
  const next = [...visible];
  [next[i], next[j]] = [next[j], next[i]];
  d.transact(() => {
    const order = extOrder(d, side)!;
    order.delete(0, order.length);
    order.push(next);
  }, LOCAL);
}

export const extText = (d: Y.Doc, id: string, f: ExtField) => extItems(d)?.get(id)?.get(f) as Y.Text | undefined;

/** Plain copy of both lists (used when copying flows/templates and pushing to a template). */
export function readAllExt(d: Y.Doc) {
  const out: Record<Side, { title: string; summary: string; ff: string }[]> = { aff: [], con: [] };
  for (const side of ['aff', 'con'] as Side[]) {
    for (const id of listExt(d, side)) {
      const it = extItems(d)!.get(id)!;
      out[side].push({ title: String(it.get('title') ?? ''), summary: String(it.get('summary') ?? ''), ff: String(it.get('ff') ?? '') });
    }
  }
  return out;
}

/** Replace dst's extensions with src's (fresh ids). */
export function replaceExt(src: Y.Doc, dst: Y.Doc, origin: unknown = LOCAL) {
  const data = readAllExt(src);
  ensureExt(dst);
  dst.transact(() => {
    const items = extItems(dst)!;
    for (const k of [...items.keys()]) items.delete(k);
    for (const side of ['aff', 'con'] as Side[]) {
      const order = extOrder(dst, side)!;
      order.delete(0, order.length);
      const ids: string[] = [];
      for (const e of data[side]) {
        const id = newId();
        items.set(id, makeItem(e.title, e.summary, e.ff));
        ids.push(id);
      }
      order.push(ids);
    }
  }, origin);
}

// extensions travel with flows/templates whenever their content is copied
contentCopiers.push((src, dst) => {
  if (listExt(src, 'aff').length || listExt(src, 'con').length) replaceExt(src, dst);
});

// ---------- link a flow to the template it came from ----------
/** One-way fingerprint of a home code, so the flow can recognise "my" template without revealing my home code. */
export async function homeFingerprint(home: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pf-home:' + home));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export interface TemplateRef {
  id: string;
  owner: string; // homeFingerprint of the template owner's home
  name: string;
}
export const templateRef = (d: Y.Doc) => meta(d).get('templateRef') as TemplateRef | undefined;
export function setTemplateRef(d: Y.Doc, ref: TemplateRef) {
  d.transact(() => meta(d).set('templateRef', ref), SYSTEM);
}
