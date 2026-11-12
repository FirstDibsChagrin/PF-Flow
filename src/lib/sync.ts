// Yjs document sync: IndexedDB (offline, instant) + Supabase Realtime broadcast (live)
// + Postgres update log (durable). Any number of tabs/devices converge via CRDT merge.
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { transport, type Channel } from './transport';
import { fromBase64, toBase64 } from './util';
import { Store } from './store';
import { PresenceMonitor, type PeerView, type PresenceEvent } from './presenceMonitor';

export const LOCAL = Symbol('local-edit'); // origin for user edits (undo-tracked)
/** Cells created speculatively by a click; synced but not undo-tracked. */
export const PROVISIONAL = Symbol('provisional');
/** Bookkeeping writes (activity log, notices); synced but not undo-tracked or counted as edits. */
export const SYSTEM = Symbol('system');
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

/** Stable per-device id, so a partner who reloads is the same person (not a leave + a join). */
const DEVICE_ID = (() => {
  try {
    let k = localStorage.getItem('pf.deviceId');
    if (!k) {
      k = Math.random().toString(36).slice(2, 12);
      localStorage.setItem('pf.deviceId', k);
    }
    return k;
  } catch {
    return CLIENT_KEY;
  }
})();
export const deviceId = DEVICE_ID;
const HEARTBEAT_MS = 4000;
const STALE_MS = 12_000; // a visible partner silent this long is treated as dropped

export class DocSync {
  doc = new Y.Doc();
  idb: IndexeddbPersistence | null = null;
  status = new Store<DocStatus>({ net: 'connecting', pending: false, loaded: false, serverSynced: false });
  presence = new Store<PresenceState[]>([]);
  loaded: Promise<void>;
  private serverSyncedResolvers: (() => void)[] = [];
  private ch: Channel | null = null;
  private queue: Uint8Array[] = [];
  private flushTimer: any = null;
  private flushing = false;
  private flushBackoff = 2000;
  private lastId = 0;
  private pollTimer: any = null;
  private destroyed = false;
  private lastFull = 0;
  private myPresence: PresenceState | null = null;

  constructor(public room: string, public docId: string) {
    try {
      this.idb = new IndexeddbPersistence(`pf:${room}:${docId}`, this.doc);
    } catch (e) {
      console.warn('[pf] local storage unavailable; working in memory', e);
    }
    this.loaded = new Promise((res) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
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
      };
      if (this.idb) this.idb.once('synced', finish);
      else finish();
      // never hang on a stuck/blocked IndexedDB: carry on in memory and let the server fill in
      setTimeout(() => {
        if (!done) console.warn('[pf] local storage slow to open', this.docId);
        finish();
      }, 4000);
    });
    window.addEventListener('pagehide', this.onHide);
    this.doc.on('update', this.onDocUpdate);
    this.monitor.setSelfOnline(false); // not connected yet: collect partners silently once we are
    this.connect();
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.pull(Date.now() - this.lastFull > 120_000);
      this.publishPresence(); // expire peers we stopped hearing from
    }, 10_000);
    let lastBeat = 0;
    this.heartbeat = setInterval(() => {
      if (Date.now() - lastBeat >= HEARTBEAT_MS) {
        lastBeat = Date.now();
        this.sendCursor(); // heartbeat so partners keep seeing us (and can tell if we drop)
      }
      this.checkStale();
      this.monitor.tick();
    }, 1000);
    this.monitor.subscribe(() => {
      this.peers.set(this.monitor.snapshot());
      this.savePeers();
    });
    this.peers.set(this.monitor.snapshot());
  }

  // ---------- partner join/leave (builds on the presence signals below) ----------
  /** Partners as the header shows them: present / reconnecting / leaving / away (+ last seen). */
  peers = new Store<PeerView[]>([]);
  private presenceListeners = new Set<(e: PresenceEvent) => void>();
  onPresenceEvent(f: (e: PresenceEvent) => void) {
    this.presenceListeners.add(f);
    return () => this.presenceListeners.delete(f);
  }
  private get peersKey() {
    return `pf.peers.${this.room}.${this.docId}`;
  }
  private savePeers() {
    try {
      // remember partners per flow so "last seen" survives reloads
      localStorage.setItem(this.peersKey, JSON.stringify(this.monitor.snapshot().map((p) => ({ ...p, status: 'away' }))));
    } catch {}
  }
  monitor = new PresenceMonitor(
    () => Date.now(),
    (e) => this.presenceListeners.forEach((f) => f(e)),
    (() => {
      try {
        return JSON.parse(localStorage.getItem(`pf.peers.${this.room}.${this.docId}`) || '[]');
      } catch {
        return [];
      }
    })(),
  );
  private heartbeat: any = null;
  private lastHeard = new Map<string, { at: number; visible: boolean }>(); // by device
  private devOfKey = new Map<string, string>(); // presence key / client -> device
  private presentDevs = new Set<string>();
  private byeAt = new Map<string, number>();
  private infoOf = new Map<string, { name: string; color: string }>();

  private heardFrom(dev: string, visible: boolean | undefined, info?: { name?: string; color?: string }) {
    if (dev === DEVICE_ID) return;
    const prev = this.lastHeard.get(dev);
    this.lastHeard.set(dev, { at: Date.now(), visible: visible ?? prev?.visible ?? true });
    if (info?.name) this.infoOf.set(dev, { name: info.name, color: info.color ?? '#888' });
    const known = this.infoOf.get(dev);
    if (known) this.monitor.present(dev, known);
  }
  private checkStale() {
    const now = Date.now();
    for (const [dev, h] of this.lastHeard) {
      // A visible partner sends a heartbeat every 4 s, so silence means a dropped connection
      // (Presence itself can take much longer to notice). Hidden tabs get their timers throttled
      // by the browser, so those are judged by Presence membership only.
      if (h.visible && now - h.at > STALE_MS) this.monitor.gone(dev);
    }
  }
  private updateSelfOnline() {
    this.monitor.setSelfOnline(this.joined && navigator.onLine);
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

  // Membership comes from Realtime Presence (rate-limited, so only name/color are tracked);
  // cursor positions travel over broadcast, which tolerates frequent updates.
  private members = new Map<string, { name: string; color: string }>();
  // peers heard from over broadcast (shows partners instantly; Presence can lag a few seconds)
  private heard = new Map<string, { name: string; color: string; at: number }>();
  private cursors = new Map<string, { sheet: string | null; node: string | null }>();
  private publishPresence() {
    const now = Date.now();
    const all = new Map(this.members);
    for (const [id, h] of this.heard) if (!all.has(id) && now - h.at < 20_000) all.set(id, { name: h.name, color: h.color });
    const list: PresenceState[] = [];
    for (const [id, m] of all) list.push({ id, ...m, ...(this.cursors.get(id) ?? { sheet: null, node: null }) });
    this.presence.set(list);
  }

  private connect() {
    this.ch = transport.channel(`r:${this.room}:${this.docId}`, CLIENT_KEY, {
      onMessage: this.onMessage,
      onPresence: (states) => {
        this.members.clear();
        const devs = new Set<string>();
        for (const [k, arr] of Object.entries(states)) {
          const s = (arr as any[])[0];
          if (!s || k === CLIENT_KEY) continue;
          this.members.set(k, { name: s.name, color: s.color });
          const dev = s.dev || k;
          if (dev === DEVICE_ID) continue;
          this.devOfKey.set(k, dev);
          devs.add(dev);
          this.infoOf.set(dev, { name: s.name, color: s.color });
        }
        for (const dev of devs) if (!this.presentDevs.has(dev)) this.heardFrom(dev, undefined);
        for (const dev of this.presentDevs) {
          // dropped from Presence without saying goodbye -> connection loss (debounced in the monitor)
          if (!devs.has(dev) && Date.now() - (this.byeAt.get(dev) ?? 0) > 8000) this.monitor.gone(dev);
        }
        this.presentDevs = devs;
        this.publishPresence();
      },
      onStatus: (s) => {
        this.joined = s === 'connected';
        this.updateSelfOnline();
        if (s === 'connected') {
          this.backoff = 1000;
          this.setStatus({ net: 'online' });
          this.fullSync();
          this.lastMember = '';
          this.sendMember();
          this.sendCursor();
        } else if (s === 'disconnected') {
          console.debug('[pf] channel disconnected', this.docId);
          this.setStatus({ net: navigator.onLine ? 'connecting' : 'offline' });
          this.scheduleReconnect();
        }
      },
    });
  }

  private lastMember = '';
  private memberTimer: any = null;
  private sendMember() {
    if (!this.myPresence || this.memberTimer) return;
    this.memberTimer = setTimeout(() => {
      this.memberTimer = null;
      if (!this.myPresence) return;
      const m = { name: this.myPresence.name, color: this.myPresence.color, dev: DEVICE_ID };
      const key = JSON.stringify(m);
      if (key === this.lastMember) return;
      this.lastMember = key;
      this.ch?.track(m);
    }, 150);
  }

  private cursorTimer: any = null;
  private sendCursor() {
    if (this.cursorTimer) return;
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      const p = this.myPresence;
      if (p)
        this.ch?.send({
          t: 'cur',
          from: CLIENT_KEY,
          dev: DEVICE_ID,
          vis: document.visibilityState === 'visible',
          name: p.name,
          color: p.color,
          sheet: p.sheet ?? null,
          node: p.node ?? null,
        });
    }, 60);
  }

  /** Stop announcing myself in this flow right away (navigating elsewhere in the app). */
  leave() {
    if (!this.myPresence) return;
    this.ch?.send({ t: 'bye', from: CLIENT_KEY, dev: DEVICE_ID });
    this.myPresence = null;
    this.lastMember = '';
    this.ch?.untrack();
  }

  track(state: Omit<PresenceState, 'id'>) {
    this.myPresence = { ...state, id: CLIENT_KEY };
    this.sendMember();
    this.sendCursor();
  }

  private get stashKey() {
    return `pf.stash.${this.room}.${this.docId}`;
  }
  private onHide = () => {
    this.ch?.send({ t: 'bye', from: CLIENT_KEY, dev: DEVICE_ID });
    if (!this.queue.length) return;
    const merged = Y.mergeUpdates(this.queue);
    const b64 = toBase64(merged);
    try {
      localStorage.setItem(this.stashKey, b64);
    } catch {}
    if (navigator.onLine) transport.pushKeepalive(this.room, this.docId, b64);
  };

  private onOnline = () => {
    this.updateSelfOnline();
    this.setStatus({ net: 'connecting' });
    this.fullSync();
    this.scheduleReconnect();
  };
  private onOffline = () => {
    this.setStatus({ net: 'offline' });
    this.updateSelfOnline();
  };
  private onVisible = () => {
    if (document.visibilityState === 'visible') this.pull(false);
    this.sendCursor(); // tell partners we're hidden/visible right away
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || (this.idb && origin === this.idb)) return;
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
    const dev: string | undefined = msg.dev ?? this.devOfKey.get(msg.from);
    if (msg.t === 'cur') {
      this.cursors.set(msg.from, { sheet: msg.sheet, node: msg.node });
      if (msg.name) this.heard.set(msg.from, { name: msg.name, color: msg.color, at: Date.now() });
      if (dev) {
        this.devOfKey.set(msg.from, dev);
        this.heardFrom(dev, msg.vis, msg);
      }
      this.publishPresence();
    } else if (msg.t === 'bye') {
      this.heard.delete(msg.from);
      this.cursors.delete(msg.from);
      if (dev && dev !== DEVICE_ID) {
        this.byeAt.set(dev, Date.now());
        this.lastHeard.delete(dev);
        this.monitor.bye(dev);
      }
      this.publishPresence();
    } else if (msg.t === 'u') {
      Y.applyUpdate(this.doc, fromBase64(msg.d), REMOTE);
    } else if (msg.t === 'sv') {
      // a peer joined: send them whatever they are missing
      const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(msg.d));
      if (diff.length > 2 && diff.length < 200_000) this.ch?.send({ t: 'u', d: toBase64(diff), from: CLIENT_KEY });
      this.sendCursor(); // let the newcomer see where we are
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
    let failed = false;
    try {
      const merged = Y.mergeUpdates(batch);
      await transport.pushUpdate(this.room, this.docId, toBase64(merged));
      this.flushBackoff = 2000;
      if (this.queue.length === 0) this.setStatus({ pending: false });
      if (this.status.get().net !== 'online' && this.joined) this.setStatus({ net: 'online' });
    } catch {
      // keep for retry; full sync on reconnect will also reconcile via state vectors
      this.queue = batch.concat(this.queue);
      if (!navigator.onLine) this.setStatus({ net: 'offline' });
      failed = true;
      // back off (2 s -> 30 s) instead of hammering a failing server
      setTimeout(() => this.scheduleFlush(0), this.flushBackoff);
      this.flushBackoff = Math.min(this.flushBackoff * 2, 30_000);
    } finally {
      this.flushing = false;
      if (!failed && this.queue.length) this.scheduleFlush();
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
    this.ch?.send({ t: 'bye', from: CLIENT_KEY, dev: DEVICE_ID });
    clearInterval(this.heartbeat);
    const ch = this.ch;
    setTimeout(() => ch?.close(), 200);
    this.doc.off('update', this.onDocUpdate);
    // let IndexedDB finish writing before tearing down
    setTimeout(() => {
      this.idb?.destroy();
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
