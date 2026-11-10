import { beforeEach, describe, expect, it } from 'vitest';
import { FLAP_GRACE, LEAVE_GRACE, PresenceMonitor, SETTLE_MS, type PresenceEvent } from './presenceMonitor';

let t = 0;
let events: PresenceEvent[] = [];
let m: PresenceMonitor;
const ALEX = { name: 'Alex', color: '#6366f1' };
const advance = (ms: number) => {
  // tick once a second, like the app
  const end = t + ms;
  while (t < end) {
    t = Math.min(end, t + 1000);
    m.tick();
  }
};
const said = () => events.map((e) => `${e.type}${e.whileAway ? '(away)' : ''}:${e.peer.name}`);
const status = (id = 'a') => m.snapshot().find((p) => p.id === id)?.status;

beforeEach(() => {
  t = 1_000_000;
  events = [];
  m = new PresenceMonitor(() => t, (e) => events.push(e));
});

describe('opening the flow', () => {
  it('a partner already there is shown silently', () => {
    m.present('a', ALEX);
    advance(SETTLE_MS + 1000);
    expect(said()).toEqual([]);
    expect(status()).toBe('present');
  });
  it('a partner arriving after I settled triggers "joined"', () => {
    advance(SETTLE_MS + 1000);
    m.present('a', ALEX);
    expect(said()).toEqual(['joined:Alex']);
  });
  it('never fires twice for the same presence', () => {
    advance(SETTLE_MS + 1000);
    m.present('a', ALEX);
    m.present('a', ALEX);
    advance(5000);
    m.present('a', ALEX);
    expect(said()).toEqual(['joined:Alex']);
  });
});

describe('clean leave', () => {
  beforeEach(() => {
    m.present('a', ALEX);
    advance(SETTLE_MS + 1000);
  });
  it('goodbye -> "left" after the short grace', () => {
    m.bye('a');
    expect(status()).toBe('leaving');
    advance(LEAVE_GRACE + 1000);
    expect(said()).toEqual(['left:Alex']);
    expect(status()).toBe('away');
  });
  it('a page reload (goodbye then back quickly) is silent', () => {
    m.bye('a');
    advance(1500);
    m.present('a', ALEX);
    advance(20_000);
    expect(said()).toEqual([]);
    expect(status()).toBe('present');
  });
  it('coming back later after leaving is "joined"', () => {
    m.bye('a');
    advance(60_000);
    m.present('a', ALEX);
    expect(said()).toEqual(['left:Alex', 'joined:Alex']);
  });
  it('records when they were last seen', () => {
    const at = t;
    m.bye('a');
    advance(LEAVE_GRACE + 1000);
    expect(m.snapshot()[0].lastSeen).toBe(at);
  });
});

describe('connection loss and flapping', () => {
  beforeEach(() => {
    m.present('a', ALEX);
    advance(SETTLE_MS + 1000);
  });
  it('drop -> "reconnecting" in the avatar, no toast yet', () => {
    m.gone('a');
    advance(FLAP_GRACE - 2000);
    expect(status()).toBe('reconnecting');
    expect(said()).toEqual([]);
  });
  it('back within the grace: nothing at all', () => {
    m.gone('a');
    advance(6000);
    m.present('a', ALEX);
    advance(30_000);
    expect(said()).toEqual([]);
    expect(status()).toBe('present');
  });
  it('repeated quick flaps never spam', () => {
    for (let i = 0; i < 5; i++) {
      m.gone('a');
      advance(3000);
      m.present('a', ALEX);
      advance(2000);
    }
    expect(said()).toEqual([]);
  });
  it('gone past the grace -> "lost connection", then "reconnected"', () => {
    m.gone('a');
    advance(FLAP_GRACE + 1000);
    expect(said()).toEqual(['lost:Alex']);
    expect(status()).toBe('away');
    m.present('a', ALEX);
    expect(said()).toEqual(['lost:Alex', 'reconnected:Alex']);
  });
  it('last seen for a lost connection is when they dropped, not when we gave up', () => {
    const at = t;
    m.gone('a');
    advance(FLAP_GRACE + 3000);
    expect(m.snapshot()[0].lastSeen).toBe(at);
  });
  it('a goodbye while reconnecting counts as left', () => {
    m.gone('a');
    advance(2000);
    m.bye('a');
    advance(LEAVE_GRACE + 1000);
    expect(said()).toEqual(['left:Alex']);
  });
});

describe('when I am offline', () => {
  beforeEach(() => {
    m.present('a', ALEX);
    advance(SETTLE_MS + 1000);
  });
  it('nothing is reported while I am offline', () => {
    m.setSelfOnline(false);
    m.gone('a');
    m.bye('a');
    advance(60_000);
    m.present('a', ALEX);
    expect(said()).toEqual([]);
  });
  it('partner still there when I come back: silent', () => {
    m.setSelfOnline(false);
    advance(60_000);
    m.setSelfOnline(true);
    m.present('a', ALEX);
    advance(SETTLE_MS + 2000);
    expect(said()).toEqual([]);
    expect(status()).toBe('present');
  });
  it('partner left while I was away: one quiet "left" after reconnecting', () => {
    m.setSelfOnline(false);
    m.gone('a'); // whatever we glimpsed while dropping doesn't matter
    advance(60_000);
    m.setSelfOnline(true);
    advance(SETTLE_MS + 2000);
    expect(said()).toEqual(['left(away):Alex']);
    expect(status()).toBe('away');
  });
  it('partner arrived while I was away: one "joined"', () => {
    m.bye('a');
    advance(LEAVE_GRACE + 1000);
    events = [];
    m.setSelfOnline(false);
    advance(30_000);
    m.setSelfOnline(true);
    m.present('a', ALEX);
    advance(SETTLE_MS + 2000);
    expect(said()).toEqual(['joined(away):Alex']);
  });
});

describe('remembered partner', () => {
  it('a partner from an earlier visit shows as away with their last-seen time, silently', () => {
    const seen = t - 180_000;
    m = new PresenceMonitor(() => t, (e) => events.push(e), [{ id: 'a', ...ALEX, status: 'away', lastSeen: seen, reason: 'left' }]);
    advance(SETTLE_MS + 1000);
    expect(said()).toEqual([]);
    expect(m.snapshot()[0]).toMatchObject({ status: 'away', lastSeen: seen });
    m.present('a', ALEX);
    expect(said()).toEqual(['joined:Alex']);
  });
});
