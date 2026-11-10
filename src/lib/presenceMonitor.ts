// Partner join/leave/connection-loss detection (pure logic; time is injected so it's unit-testable).
//
// Inputs come from the existing presence layer (sync.ts):
//   present(id)  any sign the partner is connected (Presence membership, a heartbeat, an edit)
//   bye(id)      the partner's tab said goodbye (closed / navigated away)
//   gone(id)     the partner vanished WITHOUT a goodbye (Presence dropped them, or heartbeats stopped)
//   setSelfOnline(online)   my own connection
//   tick()       called about once a second to run timers
//
// Rules:
// - Partners already there when I open the flow (or reconnect) are shown silently ("settling").
// - present after absent -> "joined" (or "reconnected" if they had lost connection).
// - bye -> "left", unless they're back within LEAVE_GRACE (a page reload) -> nothing.
// - gone -> "reconnecting" state in the avatar; back within FLAP_GRACE -> nothing;
//   still gone after FLAP_GRACE -> "lost connection".
// - While I'm offline nothing is reported. When I'm back, after settling, I'm told only about
//   partners whose status really changed while I was away.

export type PeerStatus = 'present' | 'reconnecting' | 'leaving' | 'away';
export type AwayReason = 'left' | 'lost' | null;

export interface PeerView {
  id: string;
  name: string;
  color: string;
  status: PeerStatus;
  lastSeen: number; // ms; meaningful while not present
  reason: AwayReason;
}

export type PresenceEventType = 'joined' | 'left' | 'lost' | 'reconnected';
export interface PresenceEvent {
  type: PresenceEventType;
  peer: PeerView;
  whileAway?: boolean; // reconciled after MY reconnect
}

export interface PeerInfo {
  name: string;
  color: string;
}

export const FLAP_GRACE = 10_000; // drop + return within this = no toasts
export const LEAVE_GRACE = 4_000; // goodbye + return within this (a reload) = no toasts
export const SETTLE_MS = 2_500; // after I open/reconnect, presence is collected silently for this long

interface Peer extends PeerView {
  deadline: number; // for reconnecting/leaving
  seenWhileSettling: boolean;
}

export class PresenceMonitor {
  private peers = new Map<string, Peer>();
  private offline = false;
  private settleUntil: number;
  private initial = true; // first settle after opening: never notify
  private baseline = new Map<string, boolean>(); // was present before I went offline
  private listeners = new Set<() => void>();

  constructor(
    private now: () => number,
    private emit: (e: PresenceEvent) => void,
    restored: PeerView[] = [], // partners remembered from earlier visits (shown as away with last-seen)
  ) {
    this.settleUntil = now() + SETTLE_MS;
    for (const p of restored) this.peers.set(p.id, { ...p, status: 'away', deadline: 0, seenWhileSettling: false });
  }

  get settling() {
    return this.now() < this.settleUntil;
  }
  get selfOffline() {
    return this.offline;
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private changed() {
    this.listeners.forEach((f) => f());
  }

  snapshot(): PeerView[] {
    return [...this.peers.values()].map(({ deadline: _d, seenWhileSettling: _s, ...v }) => v);
  }

  private view(p: Peer): PeerView {
    const { deadline: _d, seenWhileSettling: _s, ...v } = p;
    return { ...v };
  }

  present(id: string, info: PeerInfo) {
    const t = this.now();
    let p = this.peers.get(id);
    if (!p) {
      p = { id, ...info, status: 'away', lastSeen: t, reason: null, deadline: 0, seenWhileSettling: false };
      this.peers.set(id, p);
    }
    p.name = info.name || p.name;
    p.color = info.color || p.color;
    const before = p.status;
    const reason = p.reason;
    p.lastSeen = t;
    p.seenWhileSettling = true;
    if (before === 'present') return;
    p.status = 'present';
    p.reason = null;
    if (!this.offline && !this.settling && before === 'away') {
      this.emit({ type: reason === 'lost' ? 'reconnected' : 'joined', peer: this.view(p) });
    }
    // reconnecting / leaving -> present: a flap or a reload, deliberately silent
    this.changed();
  }

  bye(id: string) {
    const p = this.peers.get(id);
    if (!p || p.status === 'away') return;
    const t = this.now();
    p.status = 'leaving';
    p.lastSeen = t;
    p.deadline = t + LEAVE_GRACE;
    this.changed();
  }

  gone(id: string) {
    const p = this.peers.get(id);
    if (!p || p.status !== 'present') return;
    const t = this.now();
    p.status = 'reconnecting';
    p.deadline = t + FLAP_GRACE;
    this.changed();
  }

  setSelfOnline(online: boolean) {
    if (online === !this.offline) return;
    if (!online) {
      this.offline = true;
      if (!this.initial) {
        this.baseline = new Map([...this.peers].map(([id, p]) => [id, p.status !== 'away']));
      }
    } else {
      this.offline = false;
      // collect who's there now, quietly, then reconcile against the baseline
      this.settleUntil = this.now() + SETTLE_MS;
      for (const p of this.peers.values()) {
        p.seenWhileSettling = false;
        // pending timers from before I dropped are meaningless now; the reconcile decides
        if (p.status === 'reconnecting' || p.status === 'leaving') p.status = 'present';
      }
    }
    this.changed();
  }

  tick() {
    const t = this.now();
    let dirty = false;
    if (!this.offline) {
      for (const p of this.peers.values()) {
        if ((p.status === 'reconnecting' || p.status === 'leaving') && t >= p.deadline) {
          const lost = p.status === 'reconnecting';
          p.status = 'away';
          p.reason = lost ? 'lost' : 'left';
          if (lost) p.lastSeen = p.deadline - FLAP_GRACE;
          dirty = true;
          if (!this.settling) this.emit({ type: lost ? 'lost' : 'left', peer: this.view(p) });
        }
      }
    }
    if (!this.offline && this.settleUntil && t >= this.settleUntil) {
      // end of a settle window
      const first = this.initial;
      this.initial = false;
      this.settleUntil = 0;
      for (const p of this.peers.values()) {
        if (p.status === 'present' && !p.seenWhileSettling) {
          // was present before I dropped, not seen since I came back
          p.status = 'away';
          p.reason = 'left';
          dirty = true;
        }
      }
      if (!first) {
        for (const p of this.peers.values()) {
          const was = this.baseline.get(p.id) ?? false;
          const is = p.status !== 'away';
          if (was !== is) this.emit({ type: is ? 'joined' : 'left', peer: this.view(p), whileAway: true });
        }
      }
      this.baseline.clear();
      dirty = true;
    }
    if (dirty) this.changed();
  }
}
