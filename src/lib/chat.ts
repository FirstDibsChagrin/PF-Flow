// Per-flow partner chat, stored in the flow doc (so it persists with the flow, is visible only to
// people with the flow's code, and queues offline like any other edit).
import * as Y from 'yjs';
import { clientKey, SYSTEM } from './sync';
import { serverNow } from './transport';
import { Store } from './store';
import { newId } from './util';

export interface ChatMsg {
  id: string;
  by: string;
  color: string;
  client: string;
  at: number;
  text: string;
  cell?: string; // optional attached cell id
}

export const chatArray = (d: Y.Doc) => d.getArray<ChatMsg>('chat');

export function sendChat(d: Y.Doc, msg: { by: string; color: string; text: string; cell?: string | null }) {
  const m: ChatMsg = { id: newId(), by: msg.by, color: msg.color, client: clientKey, at: serverNow(), text: msg.text };
  if (msg.cell) m.cell = msg.cell;
  d.transact(() => chatArray(d).push([m]), SYSTEM);
  return m;
}

const readKey = (room: string) => `pf.chatRead.${room}`;
export function lastRead(room: string): number {
  return Number(localStorage.getItem(readKey(room)) || 0);
}
export function markRead(room: string, at = serverNow()) {
  localStorage.setItem(readKey(room), String(at));
}
export function hasUnread(d: Y.Doc, room: string): boolean {
  const since = lastRead(room);
  const arr = chatArray(d);
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr.get(i);
    if (m.at <= since) break;
    if (m.client !== clientKey) return true;
  }
  return false;
}

/** cell id -> attached message ids, kept up to date for cell markers. */
export function chatCellIndex(d: Y.Doc): { store: Store<Record<string, string[]>>; destroy: () => void } {
  const store = new Store<Record<string, string[]>>({});
  const build = () => {
    const out: Record<string, string[]> = {};
    for (const m of chatArray(d).toArray()) if (m.cell) (out[m.cell] ??= []).push(m.id);
    store.set(out);
  };
  build();
  chatArray(d).observe(build);
  return { store, destroy: () => chatArray(d).unobserve(build) };
}
