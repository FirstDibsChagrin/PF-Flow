import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FlowEditor } from '../lib/editor';
import {
  addSheet,
  ALL_SPEECHES,
  cellsBeyondColumns,
  deleteSheet,
  liveChildren,
  makeColumn,
  meta,
  moveSheet,
  rootOf,
  sheetOrder,
  sheetsMap,
  txn,
  type Mode,
} from '../lib/model';
import { bindEntry, createTemplate, FLOW_DOC, homeCode, rememberFlow } from '../lib/room';
import { currentFlow } from './SettingsPanel';
import { RoundInfoPanel, RoundInfoSummary } from './RoundInfo';
import { DOCK_ITEMS, DockStrip } from './Dock';
import { DockPanels } from './DockPanels';
import { PreviewView, previewStore } from './History';
import { ActivityRecorder, AUTO_SNAPSHOT_MS, flushPendingSnapshots, lastSnapshotAt, saveSnapshot, type RestoreNotice } from '../lib/history';
import { partnerColor, settings } from '../lib/settings';
import { clientKey } from '../lib/sync';
import { chatArray, chatCellIndex, hasUnread } from '../lib/chat';
import { ensureRoundFields } from '../lib/round';
import { useSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { acquireDoc, releaseDoc } from '../lib/sync';
import { transport } from '../lib/transport';
import { useY } from '../lib/yhooks';
import { cls, modKey } from '../lib/util';
import { Sheet } from './Sheet';
import { TimerBar, useTimerControls } from './TimerBar';
import { confirmDialog, Icon, Menu, MenuItem, MenuSep, Presence, presenceToast, promptDialog, StatusPill, toast } from './ui';
import { openShortcuts } from './Shortcuts';
import { openSettings } from './SettingsPanel';

export function FlowPage({ kind }: { kind: 'flow' | 'template' }) {
  const params = useParams();
  // flows live under their own share code; templates live in your home
  const room = kind === 'flow' ? (params.code ?? '').toUpperCase() : homeCode();
  const docId = kind === 'flow' ? FLOW_DOC : params.id ?? '';
  const entryId = kind === 'flow' ? room : docId;
  const [editor, setEditor] = useState<FlowEditor | null>(null);
  useEffect(() => {
    const sync = acquireDoc(room, docId);
    const ed = new FlowEditor(sync, room, docId);
    let cancelled = false;
    sync.loaded.then(() => !cancelled && setEditor(ed));
    const unbind = bindEntry(entryId, sync.doc);
    currentFlow.set(kind === 'flow' ? sync.doc : null);
    return () => {
      cancelled = true;
      unbind();
      ed.destroy();
      currentFlow.set(null);
      sync.leave(); // partner sees me leave now, not when the cached doc is torn down 30 s later
      releaseDoc(room, docId);
    };
  }, [room, docId]);
  if (!editor) return <div className="t3 flex h-full items-center justify-center text-sm">Loading flow…</div>;
  return <FlowView key={room + docId} editor={editor} kind={kind} />;
}

const EXTRA_PRESETS = ['Weighing', 'Offs', 'Overview', 'Notes'];

function FlowView({ editor, kind }: { editor: FlowEditor; kind: 'flow' | 'template' }) {
  const nav = useNavigate();
  const doc = editor.doc;
  const sync = editor.sync;
  const m = meta(doc);
  const sheetKey = 'pf.sheet.' + editor.room + editor.id;
  useY(m);
  useY(sheetOrder(doc));
  useY(sheetsMap(doc), true);
  const status = useStore(sync.status);
  const meName = useSettings((s) => s.name);
  const meColor = useSettings((s) => s.color);
  const sheets = editor.sheets();
  const active = useStore(editor.activeSheet);
  const focus = useStore(editor.focus);
  const mode: Mode = m.get('mode') || 'aff';
  const name: string = m.get('name') || 'Untitled';
  const missing = status.serverSynced && !m.get('name') && sheets.length === 0;
  const dock = useStore(editor.dock);
  const roundOpen = dock === 'round';
  useEffect(() => {
    if (kind !== 'flow' || !m.get('name')) return;
    // create shared fields once the server copy is in (or after a short wait when offline)
    if (status.serverSynced) ensureRoundFields(doc);
    else {
      const t = setTimeout(() => ensureRoundFields(doc), 3000);
      return () => clearTimeout(t);
    }
  }, [kind, status.serverSynced, m.get('name')]);

  // opening a flow by its code (or link) adds it to your dashboard
  useEffect(() => {
    if (kind === 'flow' && m.get('name')) rememberFlow(editor.room, doc);
  }, [kind, m.get('name')]);

  // keep a valid active sheet
  useEffect(() => {
    if (!active || !sheets.includes(active)) {
      const saved = sessionStorage.getItem(sheetKey);
      editor.activeSheet.set(saved && sheets.includes(saved) ? saved : sheets[0] ?? null);
    }
  }, [active, sheets.join()]);
  useEffect(() => {
    if (active) sessionStorage.setItem(sheetKey, active);
  }, [active]);

  // presence: tell partner where I am
  useEffect(() => {
    sync.track({ name: meName || 'Partner', color: meColor, sheet: focus.sheet ?? active, node: focus.node });
  }, [focus.node, focus.sheet, active, meName, meColor]);

  // remote presence might pick same color: display partner with a contrasting color

  const timers = useTimerControls(doc, mode);

  // partner join/leave: avatar states + toasts (built on the presence layer in sync.ts)
  const peers = useStore(sync.peers);
  const selfOffline = status.net === 'offline';
  const connecting = status.net === 'connecting';
  const [, rerender] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => rerender((x) => x + 1), 30_000); // keep "last seen" fresh
    return () => clearInterval(iv);
  }, []);
  const peerAvatars = peers
    .filter((p) => kind === 'flow' || p.status !== 'away')
    .map((p) => {
      const color = partnerColor(p.color, meColor, p.id);
      if (selfOffline)
        return { id: p.id, name: p.name, color, state: 'unknown' as const, title: `${p.name}: unknown, you're offline` };
      if (connecting) return { id: p.id, name: p.name, color, state: 'unknown' as const, title: `${p.name}: connecting…` };
      if (p.status === 'reconnecting') return { id: p.id, name: p.name, color, state: 'reconnecting' as const, title: `${p.name} is reconnecting…` };
      if (p.status === 'away') return { id: p.id, name: p.name, color, state: 'away' as const, title: `${p.name}: last seen ${lastSeenText(p.lastSeen)}` };
      return { id: p.id, name: p.name, color, state: 'present' as const, title: `${p.name} is here` };
    });
  useEffect(() => {
    const off = sync.onPresenceEvent((e) => {
        const s = settings.get();
        if (!s.notifyPresence) return;
        const n = e.peer.name || 'Your partner';
        const text =
          e.type === 'joined'
            ? e.whileAway
              ? `${n} joined while you were offline`
              : `${n} joined`
            : e.type === 'left'
              ? e.whileAway
                ? `${n} left while you were offline`
                : `${n} left`
              : e.type === 'lost'
                ? `${n} lost connection`
                : `${n} reconnected`;
        presenceToast(text, partnerColor(e.peer.color, s.color, e.peer.id));
        if (s.presenceSound) softChime(e.type === 'joined' || e.type === 'reconnected');
    });
    return () => {
      off();
    };
  }, [sync]);
  const dockDots = useDockDots(editor);
  const preview = useStore(previewStore);

  // activity log + automatic versions (~every 5 min while edits are happening)
  useEffect(() => {
    if (kind !== 'flow') return;
    const rec = new ActivityRecorder(
      doc,
      () => ({ name: settings.get().name || 'Someone', color: settings.get().color }),
      () => editor.activeSheet.get(),
    );
    const room = editor.room;
    if (!lastSnapshotAt(room)) localStorage.setItem(`pf.lastSnap.${room}`, String(Date.now()));
    const tick = async () => {
      flushPendingSnapshots();
      if (!rec.dirtySince || Date.now() - lastSnapshotAt(room) < AUTO_SNAPSHOT_MS) return;
      rec.flush();
      rec.dirtySince = 0;
      await saveSnapshot(room, doc, { name: null, kind: 'auto', by: settings.get().name || 'Someone' });
    };
    const iv = setInterval(tick, Math.min(30_000, AUTO_SNAPSHOT_MS / 2));
    window.addEventListener('online', flushPendingSnapshots);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', flushPendingSnapshots);
      rec.destroy();
      previewStore.get()?.doc.destroy();
      previewStore.set(null);
    };
  }, [doc, kind]);

  // chat: keep the cell -> messages index for cell markers
  useEffect(() => {
    if (kind !== 'flow') return;
    const idx = chatCellIndex(doc);
    const sync = () => editor.chatCells.set(idx.store.get());
    sync();
    const un = idx.store.subscribe(sync);
    return () => {
      un();
      idx.destroy();
    };
  }, [doc, kind]);

  // tell me when my partner restores a version
  useEffect(() => {
    const opened = Date.now();
    const h = (ev: import('yjs').YMapEvent<any>) => {
      if (!ev.keysChanged.has('restoreNotice')) return;
      const n = m.get('restoreNotice') as RestoreNotice | undefined;
      if (n && n.client !== clientKey && n.at > opened - 5000) toast(`${n.by} ${n.text}`);
    };
    m.observe(h);
    return () => m.unobserve(h);
  }, [doc]);

  // global shortcuts
  const lastFocus = useRef<string | null>(null);
  if (focus.node) lastFocus.current = focus.node;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = modKey(e);
      const target = e.target as HTMLElement;
      const inCell = !!target.closest?.('[data-cell]');
      const inInput = /INPUT|TEXTAREA|SELECT/.test(target.tagName) && !inCell;
      if (document.querySelector('.fixed.inset-0.z-50')) return; // modal open
      if (mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const i = sheets.indexOf(editor.activeSheet.get() ?? '');
        const ni = (i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1) + sheets.length) % sheets.length;
        editor.blur();
        editor.activeSheet.set(sheets[ni]);
        return;
      }
      if ((mod && e.key === '/') || (!inInput && !inCell && e.key === '?')) {
        e.preventDefault();
        openShortcuts();
        return;
      }
      if (e.altKey && !mod && !e.shiftKey) {
        const item = DOCK_ITEMS.find((d) => e.code === 'Key' + d.key && (kind === 'flow' || !d.flowOnly));
        if (item) {
          e.preventDefault();
          if (item.id === 'round') ensureRoundFields(doc);
          editor.toggleDock(item.id);
          return;
        }
      }
      if (e.key === 'Escape' && editor.dock.get() && !inCell && !e.defaultPrevented) {
        e.preventDefault();
        editor.dock.set(null);
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && kind === 'flow' && !inInput) {
        const c = e.code;
        const act: Record<string, () => void> = {
          KeyS: () => timers.toggle('speech'),
          KeyA: () => timers.toggle('prep-aff'),
          KeyC: () => timers.toggle('prep-con'),
          KeyN: () => timers.go(timers.idx + 1),
          KeyP: () => timers.go(timers.idx - 1),
          KeyR: () => timers.reset('speech'),
        };
        if (act[c]) {
          e.preventDefault();
          act[c]();
          return;
        }
      }
      if (inInput || inCell) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.undo.redo();
        else editor.undo.undo();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key) && !mod && !e.altKey) {
        const sheet = editor.activeSheet.get();
        if (!sheet) return;
        e.preventDefault();
        const lf = lastFocus.current;
        if (lf && editor.focusable(lf) && editor.doc.getMap<any>('nodes').get(lf)?.get('sheet') === sheet) editor.setFocus(lf);
        else {
          const first = liveChildren(doc, rootOf(sheet)).find((x) => editor.focusable(x)) ?? editor.firstFocusableDescendant(rootOf(sheet));
          if (first) editor.setFocus(first);
          else editor.addRow(sheet);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sheets.join(), timers.idx, timers.speechMs, timers.prepMs, kind]);

  const rename = async () => {
    const v = await promptDialog(kind === 'template' ? 'Rename template' : 'Rename flow', name);
    if (v) txn(doc, () => m.set('name', v));
  };

  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    const lost = cellsBeyondColumns(doc, next);
    const ok = await confirmDialog(
      `Switch to ${next === 'aff' ? 'Aff' : 'Con'} speaks first?`,
      <>
        Column labels on the Aff and Con sheets will re-map; cells keep their positions (constructives stay in the first column).
        {lost > 0 && (
          <>
            {' '}
            <b>
              {lost} cell{lost > 1 ? 's' : ''} in the last column will be hidden
            </b>{' '}
            because that sheet gets one fewer column. They are not deleted and reappear if you switch back.
          </>
        )}
      </>,
      'Switch',
    );
    if (ok) txn(doc, () => m.set('mode', next));
  };

  const saveAsTemplate = async () => {
    const v = await promptDialog('Save as template', `${name} template`, 'Save template');
    if (!v) return;
    await createTemplate({ name: v, mode, from: { room: editor.room, doc: editor.id } });
    toast('Template saved to your Templates');
  };

  if (missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="t2 text-sm">{kind === 'flow' ? `No flow with the code ${editor.room}. It may have been deleted.` : 'This template was deleted.'}</div>
        <Link className="btn btn-outline" to="/">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bd px-3" style={{ background: 'var(--panel)' }}>
        <button className="btn !px-2" onClick={() => nav(kind === 'template' ? '/templates' : '/')} title="Back to dashboard">
          <Icon.back />
        </button>
        <button className="min-w-0 shrink truncate rounded-md px-1.5 py-0.5 text-[15px] font-semibold hover:bg-[var(--hover-bg)]" onClick={rename} title="Rename" data-testid="flow-name">
          {name}
        </button>
        {kind === 'template' && <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] font-medium t2">Template</span>}
        <div className="flex shrink-0 items-center whitespace-nowrap rounded-lg border bd p-0.5 text-[12px] font-medium" data-testid="mode-toggle" title="Speaking order: which side speaks first">
          {(['aff', 'con'] as Mode[]).map((s) => (
            <button
              key={s}
              className={cls('rounded-md px-2.5 py-1 transition-colors', mode === s ? 'text-white' : 't2 hover:bg-[var(--hover-bg)]')}
              style={mode === s ? { background: s === 'aff' ? 'var(--aff)' : 'var(--con)' } : undefined}
              onClick={() => switchMode(s)}
            >
              {s === 'aff' ? 'Aff' : 'Con'} first
            </button>
          ))}
        </div>
        {kind === 'flow' && (
          <button
            className={cls('btn btn-outline min-w-0 shrink whitespace-nowrap', roundOpen && 'bg-[var(--panel-2)]')}
            onClick={() => {
              ensureRoundFields(doc);
              editor.toggleDock('round');
            }}
            title="Round info: opponent, judge, tournament, result…"
            data-testid="round-info-btn"
          >
            <Icon.info /> <RoundInfoSummary doc={doc} />
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
          {kind === 'flow' && (
            <button
              className="btn btn-outline gap-2"
              title="Share this code with your partner. They enter it under “Join your partner's flow” on their dashboard."
              onClick={() => {
                navigator.clipboard?.writeText(editor.room);
                toast('Flow code copied. Send it to your partner.');
              }}
              data-testid="flow-code"
            >
              <span className="t3 text-[11px] font-medium uppercase tracking-wide">Code</span>
              <span className="font-mono text-[13.5px] font-semibold tracking-[0.15em]">{editor.room}</span>
              <Icon.copy />
            </button>
          )}
          <StatusPill status={status} local={transport.kind === 'local'} compact />
          <Presence me={{ name: meName, color: meColor }} meOffline={selfOffline} peers={peerAvatars} />
          {kind === 'flow' && (
            <button className="btn btn-outline" onClick={saveAsTemplate} title="Save current flow as template">
              <Icon.template /> <span className="hidden 2xl:inline">Save as template</span>
            </button>
          )}
          <button className="btn !p-1.5" onClick={openShortcuts} title="Keyboard shortcuts (Ctrl/⌘ + /)">
            <Icon.keyboard />
          </button>
          <button className="btn !p-1.5" onClick={openSettings} title="Settings">
            <Icon.gear />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {preview ? (
            <PreviewView live={editor} preview={preview} />
          ) : (
            <>
              <TabBar editor={editor} sheets={sheets} active={active} />
              <div className="min-h-0 flex-1">{active && <Sheet key={active} editor={editor} sheet={active} presence={sync.presence} />}</div>
            </>
          )}
        </div>
        {dock === 'round' && kind === 'flow' && <RoundInfoPanel doc={doc} mode={mode} onModeChange={switchMode} onClose={() => editor.dock.set(null)} />}
        {dock && dock !== 'round' && <DockPanels editor={editor} kind={kind} panel={dock} />}
        <DockStrip editor={editor} kind={kind} dots={dockDots} />
      </div>
      {kind === 'flow' && <TimerBar doc={doc} mode={mode} />}
    </div>
  );
}

/** Unread/attention dots on dock icons (chat: partner wrote while the panel was closed). */
function useDockDots(editor: FlowEditor) {
  const arr = chatArray(editor.doc);
  useY(arr);
  const open = useStore(editor.dock);
  return { chat: open !== 'chat' && hasUnread(editor.doc, editor.room) } as Partial<Record<import('../lib/editor').DockPanel, boolean>>;
}

function TabBar({ editor, sheets, active }: { editor: FlowEditor; sheets: string[]; active: string | null }) {
  const doc = editor.doc;
  const others = useStore(editor.sync.presence);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const smap = sheetsMap(doc);

  const rename = async (id: string) => {
    const s = smap.get(id);
    const v = await promptDialog('Rename tab', s?.get('name') ?? '');
    if (v && s) txn(doc, () => s.set('name', v));
  };
  const remove = async (id: string) => {
    const s = smap.get(id);
    if (!s) return;
    const ok = await confirmDialog(`Delete the “${s.get('name')}” tab?`, 'All cells on this tab will be removed for both of you. You can undo with Ctrl/⌘+Z.', 'Delete tab', true);
    if (ok) {
      const i = sheets.indexOf(id);
      deleteSheet(doc, id);
      editor.activeSheet.set(sheets[i - 1] ?? sheets[i + 1] ?? null);
    }
  };
  const add = async (name: string | null) => {
    setAddMenu(null);
    const n = name ?? (await promptDialog('New tab', '', 'Add tab', 'e.g. Weighing'));
    if (!n) return;
    let id = '';
    txn(doc, () => {
      id = addSheet(doc, n, 'extra');
    });
    editor.activeSheet.set(id);
    const first = liveChildren(doc, rootOf(id))[0];
    if (first) editor.setFocus(first);
  };
  const toggleCol = (id: string, key: string) => {
    const s = smap.get(id);
    if (!s) return;
    const h = new Set<string>(s.get('hidden') || []);
    if (h.has(key)) h.delete(key);
    else h.add(key);
    if (h.size >= ALL_SPEECHES.length) return;
    txn(doc, () => s.set('hidden', [...h]));
  };

  return (
    <div className="flex h-10 shrink-0 items-end gap-1 border-b bd px-2" style={{ background: 'var(--panel)' }} data-testid="tabs">
      {sheets.map((id) => {
        const s = smap.get(id);
        if (!s) return null;
        const kindS = s.get('kind');
        const isActive = id === active;
        const partnerHere = others.some((o) => o.sheet === id);
        return (
          <div
            key={id}
            draggable
            onDragStart={() => setDrag(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag && drag !== id) moveSheet(doc, drag, sheets.indexOf(id));
              setDrag(null);
            }}
            onClick={() => {
              editor.blur();
              editor.activeSheet.set(id);
            }}
            onDoubleClick={() => rename(id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id });
            }}
            className={cls(
              'group relative flex h-9 cursor-pointer select-none items-center gap-2 rounded-t-lg border border-b-0 px-3 text-[13px] transition-colors',
              isActive ? 'bd font-semibold' : 'border-transparent t2 hover:bg-[var(--hover-bg)]',
            )}
            style={isActive ? { background: 'var(--bg)', marginBottom: -1, height: 37 } : undefined}
            data-testid="tab"
          >
            {kindS !== 'extra' && <span className="h-2 w-2 rounded-full" style={{ background: kindS === 'aff' ? 'var(--aff)' : 'var(--con)' }} />}
            {s.get('name')}
            {partnerHere && <span className="h-1.5 w-1.5 rounded-full" style={{ background: others.find((o) => o.sheet === id)?.color }} title="Partner is here" />}
            <button
              className="btn -mr-1.5 !p-0.5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, id });
              }}
            >
              <Icon.dots />
            </button>
          </div>
        );
      })}
      <button className="btn mb-1 !p-1.5" onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY + 10 })} title="Add tab" data-testid="add-tab">
        <Icon.plus />
      </button>
      {addMenu && (
        <Menu x={addMenu.x} y={addMenu.y} onClose={() => setAddMenu(null)}>
          {EXTRA_PRESETS.map((p) => (
            <MenuItem key={p} onClick={() => add(p)}>
              {p}
            </MenuItem>
          ))}
          <MenuSep />
          <MenuItem onClick={() => add(null)}>Custom name…</MenuItem>
        </Menu>
      )}
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => (setMenu(null), rename(menu.id))}>Rename</MenuItem>
          <MenuItem onClick={() => (setMenu(null), moveSheet(doc, menu.id, sheets.indexOf(menu.id) - 1))}>Move left</MenuItem>
          <MenuItem onClick={() => (setMenu(null), moveSheet(doc, menu.id, sheets.indexOf(menu.id) + 1))}>Move right</MenuItem>
          {smap.get(menu.id)?.get('kind') === 'extra' && (
            <>
              <MenuSep />
              <div className="t3 px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide">Columns</div>
              {ALL_SPEECHES.map((k) => {
                const col = makeColumn(k, (meta(doc).get('mode') as Mode) || 'aff');
                const hidden = new Set<string>(smap.get(menu.id)?.get('hidden') || []);
                return (
                  <MenuItem key={k} onClick={() => toggleCol(menu.id, k)} active={!hidden.has(k)}>
                    <span className="h-2 w-2 rounded-full" style={{ background: col.side === 'aff' ? 'var(--aff)' : 'var(--con)' }} />
                    {col.label}
                  </MenuItem>
                );
              })}
            </>
          )}
          <MenuSep />
          <MenuItem danger onClick={() => (setMenu(null), remove(menu.id))}>
            Delete tab
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}

function lastSeenText(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let chimeCtx: AudioContext | null = null;
/** Soft two-note cue (rising = joined/reconnected, falling = left/lost). */
function softChime(up: boolean) {
  try {
    chimeCtx ??= new AudioContext();
    const t = chimeCtx.currentTime;
    (up ? [523.25, 659.25] : [659.25, 523.25]).forEach((f, i) => {
      const o = chimeCtx!.createOscillator();
      const g = chimeCtx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.22);
      o.connect(g).connect(chimeCtx!.destination);
      o.start(t + i * 0.14);
      o.stop(t + i * 0.14 + 0.25);
    });
  } catch {}
}
