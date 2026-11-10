import type { ReactNode } from 'react';
import type { DockPanel, FlowEditor } from '../lib/editor';
import { useStore } from '../lib/store';
import { cls, isMac } from '../lib/util';
import { Icon } from './ui';

const A = isMac ? '⌥' : 'Alt+';
export const DOCK_ITEMS: { id: DockPanel; label: string; key: string; icon: () => JSX.Element; flowOnly?: boolean }[] = [
  { id: 'round', label: 'Round info', key: 'I', icon: Icon.info, flowOnly: true },
  { id: 'tracker', label: 'Drop/extend tracker', key: 'T', icon: Icon.tracker, flowOnly: true },
  { id: 'evidence', label: 'Evidence calls', key: 'V', icon: () => <Icon.card />, flowOnly: true },
  { id: 'ext', label: 'Extensions', key: 'E', icon: Icon.book },
  { id: 'chat', label: 'Partner chat', key: 'M', icon: Icon.chat, flowOnly: true },
  { id: 'history', label: 'Version history', key: 'H', icon: Icon.history, flowOnly: true },
];

/** Vertical icon strip on the right edge; one panel open at a time. */
export function DockStrip({ editor, kind, dots }: { editor: FlowEditor; kind: 'flow' | 'template'; dots?: Partial<Record<DockPanel, boolean>> }) {
  const open = useStore(editor.dock);
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-l bd py-2" style={{ background: 'var(--panel)' }} data-testid="dock-strip">
      {DOCK_ITEMS.filter((d) => kind === 'flow' || !d.flowOnly).map((d) => (
        <button
          key={d.id}
          className={cls('btn relative !p-2', open === d.id ? 'bg-[var(--panel-2)] text-[var(--accent)]' : 't2')}
          title={`${d.label} (${A}${d.key})`}
          onClick={() => editor.toggleDock(d.id)}
          data-testid={`dock-${d.id}`}
        >
          <d.icon />
          {dots?.[d.id] && open !== d.id && <span className="absolute right-1 top-1 h-2 w-2 rounded-full ring-2" style={{ background: 'var(--accent)', ['--tw-ring-color' as any]: 'var(--panel)' }} data-testid={`dot-${d.id}`} />}
        </button>
      ))}
    </div>
  );
}

/** Common frame for dock panels. */
export function DockFrame(props: { title: ReactNode; onClose: () => void; actions?: ReactNode; children: ReactNode; footer?: ReactNode; testid?: string; width?: number }) {
  return (
    <aside
      className="slide-in flex h-full shrink-0 flex-col border-l bd"
      style={{ background: 'var(--panel)', width: props.width ?? 400 }}
      data-testid={props.testid}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bd px-4">
        <div className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{props.title}</div>
        {props.actions}
        <button className="btn -mr-1.5 !p-1.5" onClick={props.onClose} title="Close (Esc)">
          <Icon.close />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{props.children}</div>
      {props.footer && <div className="shrink-0 border-t bd">{props.footer}</div>}
    </aside>
  );
}
