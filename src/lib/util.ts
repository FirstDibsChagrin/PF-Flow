export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export function randomString(len: number, alphabet: string): string {
  const out: string[] = [];
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  while (out.length < len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of bytes) {
      if (b < max && out.length < len) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

export const newRoomCode = () => randomString(8, ROOM_ALPHABET);
export const newId = () => randomString(12, 'abcdefghijklmnopqrstuvwxyz0123456789');

export function normalizeRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export const isValidRoomCode = (s: string) => /^[A-HJKMNP-Z2-9]{8}$/.test(s);

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 45_000) return 'just now';
  const m = Math.round(d / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}
