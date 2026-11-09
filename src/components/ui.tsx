import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Store, useStore } from '../lib/store';
import { cls } from '../lib/util';
import type { DocStatus, PresenceState } from '../lib/sync';

// ---------- icons (inline, stroke-based) ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const Icon = {
  plus: (p: { s?: number }) => (
    <svg width={p.s ?? 16} height={p.s ?? 16} viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>
  ),
  back: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><path d="M15 18l-6-6 6-6" /></svg>
  ),
  gear: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  keyboard: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>
  ),
  dots: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
  ),
  search: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
  play: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>
  ),
  pause: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
  ),
  reset: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
  ),
  next: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><path d="M9 6l6 6-6 6" /></svg>
  ),
  prev: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><path d="M15 6l-6 6 6 6" /></svg>
  ),
  copy: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
  ),
  template: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
  ),
  flow: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>
  ),
  close: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  columns: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg>
  ),
  sound: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7" /></svg>
  ),
  mute: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...P}><path d="M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6" /></svg>
  ),
};

// ---------- modal ----------
export function Modal(props: { onClose: () => void; children: ReactNode; width?: number; title?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [props.onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="panel fadein max-h-[76vh] overflow-auto rounded-xl shadow-2xl" style={{ width: props.width ?? 440 }}>
        {props.title && (
          <div className="flex items-center justify-between border-b bd px-5 py-3.5">
            <div className="text-[15px] font-semibold">{props.title}</div>
            <button className="btn -mr-2 !p-1.5" onClick={props.onClose} aria-label="Close">
              <Icon.close />
            </button>
          </div>
        )}
        {props.children}
      </div>
    </div>
  );
}

// ---------- promise-based dialogs ----------
type Dialog =
  | { kind: 'confirm'; title: string; body?: ReactNode; ok: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; value: string; ok: string; placeholder?: string; resolve: (v: string | null) => void };
const dialogs = new Store<Dialog | null>(null);

export function confirmDialog(title: string, body?: ReactNode, ok = 'Confirm', danger = false) {
  return new Promise<boolean>((resolve) => dialogs.set({ kind: 'confirm', title, body, ok, danger, resolve }));
}
export function promptDialog(title: string, value = '', ok = 'Save', placeholder?: string) {
  return new Promise<string | null>((resolve) => dialogs.set({ kind: 'prompt', title, value, ok, placeholder, resolve }));
}

export function DialogHost() {
  const d = useStore(dialogs);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d?.kind === 'prompt') {
      setVal(d.value);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [d]);
  if (!d) return null;
  const close = (v: any) => {
    dialogs.set(null);
    (d.resolve as (x: any) => void)(v);
  };
  return (
    <Modal onClose={() => close(d.kind === 'confirm' ? false : null)} title={d.title} width={420}>
      <form
        className="px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (d.kind === 'confirm') close(true);
          else if (val.trim()) close(val.trim());
        }}
      >
        {d.kind === 'confirm' && d.body && <div className="t2 mb-4 text-[13.5px] leading-relaxed">{d.body}</div>}
        {d.kind === 'prompt' && (
          <input ref={inputRef} className="input mb-4" value={val} placeholder={d.placeholder} onChange={(e) => setVal(e.target.value)} autoFocus />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={() => close(d.kind === 'confirm' ? false : null)}>
            Cancel
          </button>
          <button type="submit" autoFocus={d.kind === 'confirm'} className={cls('btn', d.kind === 'confirm' && d.danger ? 'btn-danger' : 'btn-primary')}>
            {d.ok}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- toast ----------
const toasts = new Store<{ id: number; text: string }[]>([]);
export function toast(text: string) {
  const id = Math.random();
  toasts.set((t) => [...t, { id, text }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), 2600);
}
export function ToastHost() {
  const list = useStore(toasts);
  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((t) => (
        <div key={t.id} className="panel fadein rounded-lg px-3.5 py-2 text-[13px] shadow-lg">
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- status ----------
export function StatusPill({ status, local }: { status: DocStatus; local?: boolean }) {
  let color = '#10b981';
  let text = 'Connected · Saved';
  if (local) {
    color = '#a3a3a3';
    text = 'Local mode · Saved';
  } else if (status.net === 'offline') {
    color = '#f59e0b';
    text = 'Offline · changes saved locally';
  } else if (status.net === 'connecting') {
    color = '#f59e0b';
    text = status.pending ? 'Reconnecting · saved locally' : 'Connecting…';
  } else if (status.pending || !status.serverSynced) {
    color = '#6366f1';
    text = 'Syncing…';
  }
  return (
    <div className="t2 flex items-center gap-1.5 whitespace-nowrap text-[12px]" title={text} data-testid="status">
      <span className="relative flex h-2 w-2">
        {(status.net !== 'online' || status.pending) && !local && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      {text}
    </div>
  );
}

export function Avatar({ name, color, title }: { name: string; color: string; title?: string }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2"
      style={{ background: color, ['--tw-ring-color' as any]: 'var(--panel)' }}
      title={title ?? name}
    >
      {initials}
    </div>
  );
}

export function Presence({ me, others }: { me: { name: string; color: string }; others: PresenceState[] }) {
  return (
    <div className="flex items-center -space-x-1.5" data-testid="presence">
      <Avatar name={me.name} color={me.color} title={`${me.name} (you)`} />
      {others.map((o) => (
        <Avatar key={o.id} name={o.name} color={o.color} />
      ))}
    </div>
  );
}

export function Menu(props: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.min(props.x, window.innerWidth - r.width - 8),
        y: Math.min(props.y, window.innerHeight - r.height - 8),
      });
    }
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('mousedown', h, true);
    window.addEventListener('keydown', k, true);
    return () => {
      window.removeEventListener('mousedown', h, true);
      window.removeEventListener('keydown', k, true);
    };
  }, []);
  return (
    <div ref={ref} className="panel fadein fixed z-50 min-w-[200px] rounded-lg p-1 shadow-xl" style={{ left: pos.x, top: pos.y }}>
      {props.children}
    </div>
  );
}
export function MenuItem(props: { onClick: () => void; children: ReactNode; hint?: string; danger?: boolean; active?: boolean }) {
  return (
    <button
      className={cls('flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--hover-bg)]', props.danger && 'text-red-500')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      <span className="flex items-center gap-2">
        {props.children}
        {props.active && <span className="text-[10px]">✓</span>}
      </span>
      {props.hint && <span className="t3 font-mono text-[11px]">{props.hint}</span>}
    </button>
  );
}
export const MenuSep = () => <div className="my-1 border-t bd" />;
