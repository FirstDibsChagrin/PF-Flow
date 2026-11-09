import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { FlowEditor } from '../lib/editor';
import { FlowEditor as Editor } from '../lib/editor';
import {
  activityArray,
  activitySince,
  describeActivity,
  lastSnapshotAt,
  loadSnapshot,
  pendingSnapshots,
  postRestoreNotice,
  restoreFlow,
  restoreSheet,
  saveSnapshot,
  type SnapshotMeta,
} from '../lib/history';
import { sheetOrder, sheetsMap } from '../lib/model';
import { settings } from '../lib/settings';
import { Store, useStore } from '../lib/store';
import { clientKey, type DocSync } from '../lib/sync';
import { transport } from '../lib/transport';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { DockFrame } from './Dock';
import { Sheet } from './Sheet';
import { confirmDialog, Icon, promptDialog, toast } from './ui';

export interface Preview {
  meta: SnapshotMeta;
  doc: Y.Doc;
  editor: FlowEditor;
}
/** The version being previewed (null = live flow). One per open flow page. */
export const previewStore = new Store<Preview | null>(null);

const fmtTime = (iso: string | number) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return today ? `Today ${t}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${t}`;
};

export function HistoryPanel({ editor, onClose }: { editor: FlowEditor; onClose: () => void }) {
  const doc = editor.doc;
  const room = editor.room;
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const preview = useStore(previewStore);
  useY(activityArray(doc));
  const load = async () => {
    try {
      setList(await transport.listSnapshots(room));
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    if (!preview) load(); // refresh after closing a preview / restoring
  }, [preview]);
  useEffect(() => {
    const iv = setInterval(load, 30_000);
    window.addEventListener('online', load);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', load);
    };
  }, [room]);

  const saveNamed = async () => {
    const name = await promptDialog('Save version', '', 'Save', 'e.g. After rebuttals');
    if (!name) return;
    const r = await saveSnapshot(room, doc, { name, kind: 'manual', by: settings.get().name || 'Someone' });
    toast(r === 'queued' ? 'Version saved locally; it uploads when you reconnect' : `Saved “${name}”`);
    load();
  };

  const open = async (m: SnapshotMeta) => {
    if (preview?.meta.id === m.id) return;
    setBusy(m.id);
    try {
      const data = await transport.getSnapshot(room, m.id);
      if (!data) throw new Error('missing');
      const d = loadSnapshot(data);
      const ed = new Editor({ doc: d } as unknown as DocSync, room, 'preview');
      ed.readOnly = true;
      const first = sheetOrder(d).toArray()[0] ?? null;
      const live = editor.activeSheet.get();
      ed.activeSheet.set(live && sheetsMap(d).has(live) ? live : first);
      previewStore.get()?.doc.destroy();
      previewStore.set({ meta: m, doc: d, editor: ed });
    } catch {
      toast('Could not load that version. Check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const since = lastSnapshotAt(room) || (list?.[0] ? Date.parse(list[0].created_at) : 0);
  const recent = describeActivity(activitySince(doc, since));
  const log = activityArray(doc).toArray().slice(-12).reverse();
  const pending = pendingSnapshots(room);

  return (
    <DockFrame
      title="Version history"
      onClose={onClose}
      testid="history"
      actions={
        <button className="btn btn-outline !py-1" onClick={saveNamed} data-testid="save-version">
          Save version
        </button>
      }
    >
      <div className="px-4 py-3">
        <div className="t3 mb-1 text-[11px] font-semibold uppercase tracking-wide">Since the last version</div>
        <div className="t2 text-[12.5px] leading-relaxed" data-testid="since-last">
          {recent || 'No edits yet.'}
        </div>
        <div className="t3 mt-1 text-[11.5px]">A version is saved automatically about every 5 minutes while you edit.</div>
      </div>
      <div className="border-t bd px-2 py-2">
        <div className="t3 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide">Versions</div>
        {pending.map((p, i) => (
          <div key={'p' + i} className="rounded-lg px-2 py-2 text-[12.5px] opacity-70">
            <div className="font-medium">{p.name ?? 'Auto-save'} · waiting for connection</div>
            <div className="t3">{fmtTime(p.at)}</div>
          </div>
        ))}
        {error && !list && <div className="t3 px-2 py-3 text-[12.5px]">Versions are stored online. Connect to see them; versions you save now upload later.</div>}
        {list && list.length === 0 && <div className="t3 px-2 py-3 text-[12.5px]">No versions yet. Use “Save version”, or keep flowing: one is saved every few minutes.</div>}
        {!list && !error && (
          <div className="space-y-2 px-2 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--panel-2)]" />
            ))}
          </div>
        )}
        {list?.map((m) => (
          <button
            key={m.id}
            className={cls('block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--hover-bg)]', preview?.meta.id === m.id && 'bg-[var(--focus-bg)]')}
            onClick={() => open(m)}
            data-testid="version"
          >
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-medium">{m.kind === 'manual' ? m.name || 'Saved version' : 'Auto-save'}</span>
              {m.kind === 'manual' && <span className="rounded bg-[var(--panel-2)] px-1.5 text-[10.5px] font-semibold t2">Named</span>}
              <span className="t3 ml-auto text-[11.5px]">{busy === m.id ? 'Loading…' : fmtTime(m.created_at)}</span>
            </div>
            {m.summary && <div className="t2 mt-0.5 line-clamp-2 text-[12px]">{m.summary}</div>}
          </button>
        ))}
      </div>
      {log.length > 0 && (
        <div className="border-t bd px-4 py-3">
          <div className="t3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide">Recent activity</div>
          <div className="space-y-1">
            {log.map((e, i) => (
              <div key={i} className="flex gap-2 text-[12px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="t2 min-w-0 flex-1">{describeActivity([e])}</span>
                <span className="t3 shrink-0">{new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DockFrame>
  );
}

/** Read-only view of a version in place of the live grid, with restore actions. */
export function PreviewView({ live, preview }: { live: FlowEditor; preview: Preview }) {
  const pe = preview.editor;
  const d = preview.doc;
  const active = useStore(pe.activeSheet);
  const sheets = sheetOrder(d).toArray().filter((s) => sheetsMap(d).has(s));
  const [presence] = useState(() => new Store<any[]>([]));
  const when = fmtTime(preview.meta.created_at);
  const label = preview.meta.kind === 'manual' ? `“${preview.meta.name}”` : `the ${when} auto-save`;
  const close = () => {
    previewStore.set(null);
    d.destroy();
  };
  const restore = async (whole: boolean) => {
    const tab = active ? sheetsMap(d).get(active)?.get('name') : null;
    const ok = await confirmDialog(
      whole ? 'Restore the whole flow?' : `Restore the “${tab}” tab?`,
      `${whole ? 'Every tab' : 'This tab'} will be replaced with ${label} for both of you. A version named “Before restore” is saved first, so you can undo this from history (or with Ctrl/⌘+Z).`,
      'Restore',
    );
    if (!ok) return;
    const me = settings.get().name || 'Someone';
    await saveSnapshot(live.room, live.doc, { name: 'Before restore', kind: 'manual', by: me });
    if (whole) restoreFlow(live.doc, d);
    else if (active) restoreSheet(live.doc, d, active);
    postRestoreNotice(live.doc, { by: me, client: clientKey, at: Date.now(), text: whole ? `restored the whole flow to ${label}` : `restored the ${tab} tab to ${label}` });
    if (!whole && active) live.activeSheet.set(active);
    toast(whole ? 'Flow restored' : `${tab} tab restored`);
    close();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.fixed.inset-0.z-50')) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  return (
    <div className="flex h-full flex-col" data-testid="preview">
      <div className="flex shrink-0 items-center gap-3 border-b bd px-3 py-2" style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--panel))' }}>
        <Icon.history />
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">Previewing {preview.meta.kind === 'manual' ? `“${preview.meta.name}”` : 'auto-save'}</span>
          <span className="t2"> · {when} · read-only</span>
        </div>
        <button className="btn btn-outline !py-1" onClick={() => restore(false)} disabled={!active} data-testid="restore-tab">
          Restore this tab
        </button>
        <button className="btn btn-outline !py-1" onClick={() => restore(true)} data-testid="restore-flow">
          Restore whole flow
        </button>
        <button className="btn btn-primary !py-1" onClick={close} data-testid="back-live">
          Back to live
        </button>
      </div>
      <div className="flex h-10 shrink-0 items-end gap-1 border-b bd px-2" style={{ background: 'var(--panel)' }}>
        {sheets.map((id) => (
          <button
            key={id}
            className={cls('h-9 rounded-t-lg border border-b-0 px-3 text-[13px]', id === active ? 'bd font-semibold' : 'border-transparent t2')}
            style={id === active ? { background: 'var(--bg)', marginBottom: -1, height: 37 } : undefined}
            onClick={() => pe.activeSheet.set(id)}
          >
            {sheetsMap(d).get(id)?.get('name')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{active && <Sheet key={active} editor={pe} sheet={active} presence={presence} />}</div>
    </div>
  );
}
