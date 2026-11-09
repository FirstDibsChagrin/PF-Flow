// Network transport: Supabase (production) or a local BroadcastChannel/localStorage
// fallback used when no Supabase env vars are configured (single-machine dev/testing).
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export type ChannelStatus = 'connecting' | 'connected' | 'disconnected';
export interface ChannelHandlers {
  onMessage: (msg: any) => void;
  onPresence: (states: Record<string, any>) => void;
  onStatus: (s: ChannelStatus) => void;
}
export interface Channel {
  send(msg: any): Promise<boolean>;
  track(state: any): void;
  close(): void;
}
export interface UpdateRow {
  id: number;
  update: string;
}
export interface Transport {
  kind: 'supabase' | 'local';
  createRoom(code: string): Promise<boolean>;
  roomExists(code: string): Promise<boolean>;
  getUpdates(room: string, doc: string, after?: number): Promise<UpdateRow[]>;
  pushUpdate(room: string, doc: string, update: string): Promise<number>;
  compact(room: string, doc: string, merged: string, ids: number[]): Promise<void>;
  deleteDoc(room: string, doc: string): Promise<void>;
  serverTime(): Promise<number>;
  /** Fire-and-forget push that survives page unload. */
  pushKeepalive(room: string, doc: string, update: string): void;
  channel(name: string, presenceKey: string, h: ChannelHandlers): Channel;
}

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function withTimeout<T>(p: PromiseLike<T>, ms = 8000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    Promise.resolve(p).then(
      (v) => (clearTimeout(t), res(v)),
      (e) => (clearTimeout(t), rej(e)),
    );
  });
}

class SupabaseTransport implements Transport {
  kind = 'supabase' as const;
  sb: SupabaseClient;
  constructor(url: string, key: string) {
    this.sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 60 } },
    });
  }
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline');
    const { data, error } = await withTimeout(this.sb.rpc(fn, args));
    if (error) throw new Error(error.message);
    return data as T;
  }
  createRoom = (code: string) => this.rpc<boolean>('pf_create_room', { p_code: code });
  roomExists = (code: string) => this.rpc<boolean>('pf_room_exists', { p_code: code });
  getUpdates = (room: string, doc: string, after = 0) =>
    this.rpc<UpdateRow[]>('pf_get_updates', { p_code: room, p_doc: doc, p_after: after });
  pushUpdate = (room: string, doc: string, update: string) =>
    this.rpc<number>('pf_push_update', { p_code: room, p_doc: doc, p_update: update });
  compact = async (room: string, doc: string, merged: string, ids: number[]) => {
    await this.rpc('pf_compact', { p_code: room, p_doc: doc, p_merged: merged, p_ids: ids });
  };
  deleteDoc = async (room: string, doc: string) => {
    await this.rpc('pf_delete_doc', { p_code: room, p_doc: doc });
  };
  serverTime = () => this.rpc<number>('pf_server_time', {});
  pushKeepalive(room: string, doc: string, update: string) {
    if (update.length > 60_000) return;
    try {
      fetch(`${URL_}/rest/v1/rpc/pf_push_update`, {
        method: 'POST',
        keepalive: true,
        headers: { apikey: KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_code: room, p_doc: doc, p_update: update }),
      }).catch(() => {});
    } catch {}
  }

  channel(name: string, presenceKey: string, h: ChannelHandlers): Channel {
    let ch: RealtimeChannel | null = this.sb.channel(name, {
      config: { broadcast: { self: false, ack: false }, presence: { key: presenceKey } },
    });
    let joined = false;
    let lastTrack: any = null;
    let retry: any = null;
    const doTrack = async () => {
      if (!ch || !joined || !lastTrack) return;
      const sent = lastTrack;
      const r = await ch.track(sent).catch(() => 'error');
      if (r !== 'ok' && !retry) {
        retry = setTimeout(() => {
          retry = null;
          doTrack();
        }, 400);
      }
    };
    ch.on('broadcast', { event: 'm' }, ({ payload }) => h.onMessage(payload));
    ch.on('presence', { event: 'sync' }, () => {
      if (ch) h.onPresence(ch.presenceState());
    });
    h.onStatus('connecting');
    ch.subscribe((status, err) => {
      if (status !== 'SUBSCRIBED') console.debug('[pf] realtime', name, status, err?.message ?? '');
      if (status === 'SUBSCRIBED') {
        joined = true;
        h.onStatus('connected');
        if (lastTrack) doTrack();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        joined = false;
        h.onStatus('disconnected');
      }
    });
    return {
      send: async (msg) => {
        if (!ch || !joined) return false;
        try {
          const r = await ch.send({ type: 'broadcast', event: 'm', payload: msg });
          return r === 'ok';
        } catch {
          return false;
        }
      },
      track: (state) => {
        lastTrack = state;
        doTrack();
      },
      close: () => {
        if (ch) this.sb.removeChannel(ch);
        ch = null;
      },
    };
  }
}

// ---------- Local fallback (no backend): syncs between tabs of one browser ----------
class LocalTransport implements Transport {
  kind = 'local' as const;
  private k = (room: string, doc: string) => `pf.local.updates.${room}.${doc}`;
  private read(room: string, doc: string): UpdateRow[] {
    try {
      return JSON.parse(localStorage.getItem(this.k(room, doc)) || '[]');
    } catch {
      return [];
    }
  }
  private write(room: string, doc: string, rows: UpdateRow[]) {
    localStorage.setItem(this.k(room, doc), JSON.stringify(rows));
  }
  private nextId() {
    const n = Number(localStorage.getItem('pf.local.seq') || '0') + 1;
    localStorage.setItem('pf.local.seq', String(n));
    return n;
  }
  async createRoom(code: string) {
    const rooms = JSON.parse(localStorage.getItem('pf.local.rooms') || '[]');
    if (rooms.includes(code)) return false;
    rooms.push(code);
    localStorage.setItem('pf.local.rooms', JSON.stringify(rooms));
    return true;
  }
  async roomExists(code: string) {
    return JSON.parse(localStorage.getItem('pf.local.rooms') || '[]').includes(code);
  }
  async getUpdates(room: string, doc: string, after = 0) {
    return this.read(room, doc).filter((r) => r.id > after);
  }
  async pushUpdate(room: string, doc: string, update: string) {
    const rows = this.read(room, doc);
    const id = this.nextId();
    rows.push({ id, update });
    this.write(room, doc, rows);
    return id;
  }
  async compact(room: string, doc: string, merged: string, ids: number[]) {
    const set = new Set(ids);
    const rows = this.read(room, doc).filter((r) => !set.has(r.id));
    rows.push({ id: this.nextId(), update: merged });
    this.write(room, doc, rows);
  }
  async deleteDoc(room: string, doc: string) {
    localStorage.removeItem(this.k(room, doc));
  }
  async serverTime() {
    return Date.now();
  }
  pushKeepalive(room: string, doc: string, update: string) {
    this.pushUpdate(room, doc, update);
  }
  channel(name: string, presenceKey: string, h: ChannelHandlers): Channel {
    const bc = new BroadcastChannel('pf:' + name);
    const peers = new Map<string, { state: any; seen: number }>();
    let mine: any = null;
    const emit = () => {
      const out: Record<string, any> = {};
      if (mine) out[presenceKey] = [mine];
      for (const [k, v] of peers) out[k] = [v.state];
      h.onPresence(out);
    };
    bc.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'msg') h.onMessage(d.msg);
      else if (d.t === 'pres') {
        if (d.state) peers.set(d.key, { state: d.state, seen: Date.now() });
        else peers.delete(d.key);
        if (d.ask && mine) bc.postMessage({ t: 'pres', key: presenceKey, state: mine });
        emit();
      }
    };
    const iv = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of peers) if (now - v.seen > 6000) (peers.delete(k), (changed = true));
      if (mine) bc.postMessage({ t: 'pres', key: presenceKey, state: mine });
      if (changed) emit();
    }, 2000);
    setTimeout(() => h.onStatus('connected'), 0);
    return {
      send: async (msg) => (bc.postMessage({ t: 'msg', msg }), true),
      track: (state) => {
        mine = state;
        bc.postMessage({ t: 'pres', key: presenceKey, state, ask: true });
        emit();
      },
      close: () => {
        bc.postMessage({ t: 'pres', key: presenceKey, state: null });
        clearInterval(iv);
        bc.close();
      },
    };
  }
}

export const transport: Transport =
  URL_ && KEY ? new SupabaseTransport(URL_, KEY) : new LocalTransport();

// Server clock offset so synced timers agree across machines.
export let serverOffset = 0;
export async function calibrateClock() {
  try {
    const t0 = Date.now();
    const s = await transport.serverTime();
    const t1 = Date.now();
    serverOffset = s - (t0 + t1) / 2;
  } catch {
    /* offline: keep previous offset */
  }
}
export const serverNow = () => Date.now() + serverOffset;
