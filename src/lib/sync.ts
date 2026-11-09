// Yjs document sync: IndexedDB (offline, instant) + Supabase Realtime broadcast (live)
// + Postgres update log (durable). Any number of tabs/devices converge via CRDT merge.
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { transport, type Channel } from './transport';
import { fromBase64, toBase64 } from './util';
import { Store } from './store';

export const LOCAL = Symbol('local-edit'); // origin for user edits (undo-tracked)
const REMOTE = Symbol('remote');

export type NetStatus = 'connecting' | 'online' | 'offline';
export interface DocStatus {
  net: NetStatus;
  pending: boolean; // local changes not yet confirmed by the server
  loaded: boolean; // local copy loaded from IndexedDB
  serverSynced: boolean; // completed at least one full sync with server
}

export interface PresenceState {
  id: string;
  name: string;
  color: string;
  sheet?: string | null;
  node?: string | null;
  at?: number;
}

const CLIENT_KEY = (() => {
  try {
    let k = sessionStorage.getItem('pf.clientKey');
    if (!k) {
      k = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('pf.clientKey', k);
    }
    return k;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();
export const clientKey = CLIENT_KEY;

export class DocSync {
  doc = new Y.Doc();
  idb: IndexeddbPersistence;
  status = new Store<DocStatus>({ net: 'connecting', pending: false, loaded: false, serverSynced: false });
  presence = new Store<PresenceState[]>([]);
  loaded: Promise<void>;
  private serverSyncedResolvers: (() => void)[] = [];
  private ch: Channel | null = null;
  private queue: Uint8Array[] = [];
  private flushTimer: any = null;
  private flushing = false;
  private lastId = 0;
  private pollTimer: any = null;
  private destroyed = false;
  private lastFull = 0;
  private myPresence: PresenceState | null = null;

  constructor(public room: string, public docId: string) {
    this.idb = new IndexeddbPersistence(`pf:${room}:${docId}`, this.doc);
    this.loaded = new Promise((res) => {
      this.idb.once('synced', () => {
        // recover edits stashed synchronously during the last unload
        try {
          const k = this.stashKey;
          const st = localStorage.getItem(k);
          if (st) {
            Y.applyUpdate(this.doc, fromBase64(st), LOCAL);
            localStorage.removeItem(k);
          }
        } catch {}
        this.setStatus({ loaded: true });
        res();
      });
    });
    window.addEventListener('pagehide', this.onHide);
    this.doc.on('update', this.onDocUpdate);
    this.connect();
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.pull(Date.now() - this.lastFull > 120_000);
    }, 10_000);
  }

  private setStatus(p: Partial<DocStatus>) {
    this.status.set((s) => ({ ...s, ...p }));
  }

  whenServerSynced(timeoutMs = 5000): Promise<boolean> {
    if (this.status.get().serverSynced) return Promise.resolve(true);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), timeoutMs);
      this.serverSyncedResolvers.push(() => (clearTimeout(t), res(true)));
    });
  }

  private joined = false;
  private reconnectTimer: any = null;
  private backoff = 1000;
  private scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed || this.joined) return;
      if (!navigator.onLine) return this.scheduleReconnect();
      this.ch?.close();
      this.connect();
      this.backoff = Math.min(this.backoff * 2, 15000);
    }, this.backoff);
  }

  private connect() {
    this.ch = transport.channel(`r:${this.room}:${this.docId}`, CLIENT_KEY, {
      onMessage: this.onMessage,
      onPresence: (states) => {
        const list: PresenceState[] = [];
        for (const [k, arr] of Object.entries(states)) {
          const s = (arr as any[])[0];
          if (s && k !== CLIENT_KEY) list.push({ ...s, id: k });
        }
        this.presence.set(list);
      },
      onStatus: (s) => {
        this.joined = s === 'connected';
        if (s === 'connected') {
          this.backoff = 1000;
          this.setStatus({ net: 'online' });
          this.fullSync();
          if (this.myPresence) {
            this.lastSentPresence = '';
            this.track(this.myPresence);
          }
        } else if (s === 'disconnected') {
          console.debug('[pf] channel disconnected', this.docId);
          this.setStatus({ net: navigator.onLine ? 'connecting' : 'offline' });
          this.scheduleReconnect();
        }
      },
    });
  }

  private trackTimer: any = null;
  private lastSentPresence = '';
  private lastTrackAt = 0;
  track(state: Omit<PresenceState, 'id'>) {
    this.myPresence = { ...state, id: CLIENT_KEY };
    if (this.trackTimer) return;
    // presence is rate-limited server-side: throttle and drop duplicates
    const wait = Math.max(60, 350 - (Date.now() - this.lastTrackAt));
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null;
      const key = JSON.stringify(this.myPresence);
      if (!this.myPresence || key === this.lastSentPresence) return;
      this.lastSentPresence = key;
      this.lastTrackAt = Date.now();
      this.ch?.track(this.myPresence);
    }, wait);
  }

  private get stashKey() {
    return `pf.stash.${this.room}.${this.docId}`;
  }
  private onHide = () => {
    if (!this.queue.length) return;
    const merged = Y.mergeUpdates(this.queue);
    const b64 = toBase64(merged);
    try {
      localStorage.setItem(this.stashKey, b64);
    } catch {}
    if (navigator.onLine) transport.pushKeepalive(this.room, this.docId, b64);
  };

  private onOnline = () => {
    this.setStatus({ net: 'connecting' });
    this.fullSync();
    this.scheduleReconnect();
  };
  private onOffline = () => this.setStatus({ net: 'offline' });
  private onVisible = () => {
    if (document.visibilityState === 'visible') this.pull(false);
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || origin === this.idb) return;
    // broadcast live (coalesced), then queue for durable storage
    this.outbox.push(update);
    if (!this.outTimer) this.outTimer = setTimeout(this.sendOutbox, 40);
    this.queue.push(update);
    this.setStatus({ pending: true });
    this.scheduleFlush();
  };

  private outbox: Uint8Array[] = [];
  private outTimer: any = null;
  private sendOutbox = async () => {
    this.outTimer = null;
    if (!this.outbox.length || !this.ch) return;
    const batch = this.outbox;
    this.outbox = [];
    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    const ok = await this.ch.send({ t: 'u', d: toBase64(merged), from: CLIENT_KEY });
    if (!ok && this.status.get().net === 'online') {
      // rate-limited or hiccup: retry shortly (the DB log is the durable fallback)
      this.outbox.unshift(merged);
      if (!this.outTimer) this.outTimer = setTimeout(this.sendOutbox, 120);
    }
  };

  private onMessage = (msg: any) => {
    if (!msg || msg.from === CLIENT_KEY) return;
    if (msg.t === 'u') {
      Y.applyUpdate(this.doc, fromBase64(msg.d), REMOTE);
    } else if (msg.t === 'sv') {
      // a peer joined: send them whatever they are missing
      const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(msg.d));
      if (diff.length > 2 && diff.length < 200_000) this.ch?.send({ t: 'u', d: toBase64(diff), from: CLIENT_KEY });
    }
  };

  private scheduleFlush(delay = 300) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, delay);
  }

  private async flush() {
    if (this.flushing || this.destroyed || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue;
    this.queue = [];
    try {
      const merged = Y.mergeUpdates(batch);
      await transport.pushUpdate(this.room, this.docId, toBase64(merged));
      if (this.queue.length === 0) this.setStatus({ pending: false });
      if (this.status.get().net !== 'online' && this.joined) this.setStatus({ net: 'online' });
    } catch {
      // keep for retry; full sync on reconnect will also reconcile via state vectors
      this.queue = batch.concat(this.queue);
      if (!navigator.onLine) this.setStatus({ net: 'offline' });
      setTimeout(() => this.scheduleFlush(0), 4000);
    } finally {
      this.flushing = false;
      if (this.queue.length) this.scheduleFlush();
    }
  }

  private syncing = false;
  /** Fetch everything from the server, merge, and upload anything the server is missing. */
  async fullSync() {
    if (this.syncing || this.destroyed) return;
    this.syncing = true;
    try {
      await this.loaded;
      const rows = await transport.getUpdates(this.room, this.docId, 0);
      const updates = rows.map((r) => fromBase64(r.update));
      const serverDoc = new Y.Doc();
      for (const u of updates) Y.applyUpdate(serverDoc, u);
      if (updates.length) Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(serverDoc), REMOTE);
      this.lastId = rows.reduce((m, r) => Math.max(m, r.id), this.lastId);
      // what does the server lack?
      const diff = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(serverDoc));
      let changed = false;
      serverDoc.on('update', () => (changed = true));
      Y.applyUpdate(serverDoc, diff);
      if (changed) {
        await transport.pushUpdate(this.room, this.docId, toBase64(diff));
      }
      // compaction keeps loads fast
      if (rows.length > 40) {
        const merged = Y.mergeUpdates(updates);
        await transport.compact(this.room, this.docId, toBase64(merged), rows.map((r) => r.id));
      }
      serverDoc.destroy();
      this.lastFull = Date.now();
      if (this.queue.length === 0) this.setStatus({ pending: false });
      this.setStatus({ serverSynced: true, net: this.joined ? 'online' : navigator.onLine ? 'connecting' : 'offline' });
      this.serverSyncedResolvers.splice(0).forEach((r) => r());
      // ask live peers for anything not yet persisted
      this.ch?.send({ t: 'sv', d: toBase64(Y.encodeStateVector(this.doc)), from: CLIENT_KEY });
      if (this.queue.length) this.scheduleFlush(0);
    } catch (e) {
      console.debug('[pf] fullSync failed', this.docId, e);
      this.setStatus({ net: navigator.onLine ? 'connecting' : 'offline' });
    } finally {
      this.syncing = false;
    }
  }

  /** Lightweight safety-net poll for rows we may have missed via broadcast. */
  private async pull(full: boolean) {
    if (full || !this.status.get().serverSynced) return this.fullSync();
    try {
      const rows = await transport.getUpdates(this.room, this.docId, this.lastId);
      for (const r of rows) {
        Y.applyUpdate(this.doc, fromBase64(r.update), REMOTE);
        this.lastId = Math.max(this.lastId, r.id);
      }
      if (this.status.get().net !== 'online') this.fullSync();
    } catch {
      if (!navigator.onLine) this.setStatus({ net: 'offline' });
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.queue.length) this.flushNow();
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnectTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('pagehide', this.onHide);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ch?.close();
    this.doc.off('update', this.onDocUpdate);
    // let IndexedDB finish writing before tearing down
    setTimeout(() => {
      this.idb.destroy();
      this.doc.destroy();
    }, 1000);
  }
  private flushNow() {
    const merged = Y.mergeUpdates(this.queue);
    this.queue = [];
    transport.pushUpdate(this.room, this.docId, toBase64(merged)).catch(() => {});
  }
}

// ---------- Ref-counted doc cache ----------
const cache = new Map<string, { sync: DocSync; refs: number; timer?: any }>();

export function acquireDoc(room: string, docId: string): DocSync {
  const key = `${room}:${docId}`;
  let e = cache.get(key);
  if (!e) {
    e = { sync: new DocSync(room, docId), refs: 0 };
    cache.set(key, e);
  }
  if (e.timer) {
    clearTimeout(e.timer);
    e.timer = undefined;
  }
  e.refs++;
  return e.sync;
}

export function releaseDoc(room: string, docId: string) {
  const key = `${room}:${docId}`;
  const e = cache.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) {
    e.timer = setTimeout(() => {
      if (e.refs <= 0) {
        e.sync.destroy();
        cache.delete(key);
      }
    }, 30_000);
  }
}

/** Load a doc fully (local + server when reachable), run fn, release. */
export async function withDoc<T>(room: string, docId: string, fn: (s: DocSync) => T | Promise<T>, waitServer = true): Promise<T> {
  const s = acquireDoc(room, docId);
  try {
    await s.loaded;
    if (waitServer && navigator.onLine) await s.whenServerSynced(5000);
    return await fn(s);
  } finally {
    releaseDoc(room, docId);
  }
}

export async function destroyDocEverywhere(room: string, docId: string) {
  const key = `${room}:${docId}`;
  const e = cache.get(key);
  if (e) {
    e.sync.destroy();
    cache.delete(key);
  }
  try {
    indexedDB.deleteDatabase(`pf:${room}:${docId}`);
  } catch {}
  await transport.deleteDoc(room, docId).catch(() => {});
}
