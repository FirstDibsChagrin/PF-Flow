import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { FlowEditor } from '../lib/editor';
import { getNode, liveChildren, meta, rootOf, sheetsMap, setText, type Column, type Mark } from '../lib/model';
import { DEFAULT_COL_WIDTH, patchSettings, settings, useSettings } from '../lib/settings';
import { Store, useStore } from '../lib/store';
import type { PresenceState } from '../lib/sync';
import { useY } from '../lib/yhooks';
import { cls, modKey } from '../lib/util';
import { Icon, Menu, MenuItem, MenuSep } from './ui';

interface Ctx {
  editor: FlowEditor;
  sheet: string;
  columns: Column[];
  widths: number[];
  presence: Store<PresenceState[]>;
  menu: Store<{ x: number; y: number; id: string } | null>;
  readOnly?: boolean;
}

const MARK_LABEL: Record<Mark, string> = { dropped: 'Dropped', extended: 'Extended', turned: 'Turned' };

export function Sheet({ editor, sheet, presence }: { editor: FlowEditor; sheet: string; presence: Store<PresenceState[]> }) {
  const doc = editor.doc;
  const sheetMap = sheetsMap(doc).get(sheet);
  useY(meta(doc));
  useY(sheetMap);
  const roots = sheetMap?.get('children') as Y.Array<string> | undefined;
  useY(roots);
  useY(doc.getMap('nodes')); // top-level deletions
  const colWidths = useSettings((s) => s.colWidths);
  const [menuStore] = useState(() => new Store<{ x: number; y: number; id: string } | null>(null));
  const menu = useStore(menuStore);

  if (!sheetMap) return null;
  const columns = editor.columns(sheet);
  const hidden = editor.hidden(sheet);
  const widths = columns.map((c) => (hidden.has(c.key) ? 0 : colWidths[c.key] ?? DEFAULT_COL_WIDTH));
  const total = widths.reduce((a, b) => a + b, 0);
  const ctx: Ctx = { editor, sheet, columns, widths, presence, menu: menuStore };
  const rootIds = liveChildren(doc, rootOf(sheet));

  return (
    <div className="relative h-full overflow-auto" data-testid="sheet" id="sheet-scroll">
      <div className="relative min-h-full" style={{ width: total + 48, minWidth: '100%' }}>
        {/* column stripes */}
        <div className="pointer-events-none absolute inset-0 flex">
          {columns.map((c, i) => (
            <div
              key={c.key}
              className="h-full border-r bd"
              style={{ width: widths[i], background: c.side === 'aff' ? 'var(--aff-col)' : 'var(--con-col)', display: widths[i] ? undefined : 'none' }}
            />
          ))}
        </div>
        {/* headers */}
        <div className="sticky top-0 z-20 flex border-b bd" style={{ background: 'var(--panel)' }}>
          {columns.map((c, i) =>
            widths[i] ? <ColumnHeader key={c.key} col={c} width={widths[i]} onAdd={editor.readOnly ? undefined : () => editor.addInColumn(sheet, i)} /> : null,
          )}
        </div>
        {/* rows */}
        <div className="relative">
          {rootIds.map((id, i) => (
            <div key={id} className={cls('relative', i > 0 && 'border-t bd')} style={{ width: total }}>
              <NodeView id={id} level={0} ctx={ctx} />
            </div>
          ))}
        </div>
        {editor.readOnly ? <div className="min-h-[40vh]" /> : <div className={cls('flex min-h-[40vh] items-stretch', rootIds.length > 0 && 'border-t bd')} data-testid="new-row">
          {columns.map((c, i) =>
            widths[i] ? (
              <div key={c.key} className="flex shrink-0 flex-col" style={{ width: widths[i] }}>
                <Slot
                  width={widths[i]}
                  label={i === 0 ? '+ New argument' : `+ New in ${c.short}`}
                  title={`Start a new argument in ${c.label}`}
                  onClick={() => (i === 0 ? editor.addRow(sheet) : editor.startInColumn(sheet, i))}
                  testid={`new-${i}`}
                  hint={i === 0}
                />
                <div
                  className="flex-1 cursor-text"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (i === 0) editor.addRow(sheet);
                    else editor.startInColumn(sheet, i);
                  }}
                />
              </div>
            ) : null,
          )}
        </div>}
      </div>
      {menu && <CellMenu ctx={ctx} {...menu} onClose={() => menuStore.set(null)} />}
    </div>
  );
}

function ColumnHeader({ col, width, onAdd }: { col: Column; width: number; onAdd?: () => void }) {
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: MouseEvent) => {
      const w = Math.max(120, Math.min(600, w0 + ev.clientX - x0));
      patchSettings({ colWidths: { ...settings.get().colWidths, [col.key]: w } });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  };
  return (
    <div className="group relative flex h-10 shrink-0 items-center gap-2 border-r bd px-3" style={{ width }} data-testid="col-header">
      <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: col.side === 'aff' ? 'var(--aff)' : 'var(--con)' }} />
      <span className="truncate text-[12.5px] font-semibold">{col.label}</span>
      <span className="t3 font-mono text-[10.5px]">{col.short}</span>
      {onAdd && <button
        className="btn ml-auto !p-1 opacity-0 transition-opacity group-hover:opacity-100"
        title="New argument starting in this column"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAdd}
      >
        <Icon.plus s={14} />
      </button>}
      <div className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-[var(--accent)]/40" onMouseDown={startResize} title="Drag to resize" />
    </div>
  );
}

const NodeView = memo(function NodeView({ id, level, ctx }: { id: string; level: number; ctx: Ctx }) {
  const doc = ctx.editor.doc;
  const n = getNode(doc, id);
  useY(n);
  const kids = n?.get('children') as Y.Array<string> | undefined;
  useY(kids);
  if (!n || level >= ctx.columns.length) return null;
  const width = ctx.widths[level];
  const childIds = liveChildren(doc, id);
  const empty = !!n.get('empty');
  return (
    <div className="flex items-start">
      {empty && width > 0 && !ctx.editor.readOnly ? (
        <Slot width={width} label="+ add" title="Click to write in this column" onClick={() => ctx.editor.fillPlaceholder(id)} testid={'fill-' + level} />
      ) : (
        <div className="shrink-0 overflow-hidden" style={{ width }}>
          {width === 0 ? null : empty ? <div style={{ height: 4 }} /> : <Cell id={id} n={n} level={level} ctx={ctx} />}
        </div>
      )}
      {childIds.length > 0 ? (
        <div className="flex flex-col">
          {childIds.map((c) => (
            <NodeView key={c} id={c} level={level + 1} ctx={ctx} />
          ))}
        </div>
      ) : (
        !empty && !ctx.editor.readOnly && <RespondSlots id={id} level={level} ctx={ctx} />
      )}
    </div>
  );
});

/** One empty, clickable grid spot. Stretches to the height of its row. */
function Slot(props: { width: number; label: string; title: string; onClick: () => void; testid?: string; hint?: boolean }) {
  return (
    <div
      className="group/slot flex shrink-0 cursor-text self-stretch px-1 py-[3px]"
      style={{ width: props.width }}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
      title={props.title}
      data-slot={props.testid}
    >
      <div className="respond-slot flex-1">
        <span className={cls('t3 transition-opacity group-hover/slot:opacity-100', props.hint ? 'opacity-60' : 'opacity-0')}>{props.label}</span>
      </div>
    </div>
  );
}

/**
 * The empty columns to the right of an argument that has no response yet. Clicking any of them
 * starts a response in that column, in this row (blank placeholders fill the columns between).
 */
function RespondSlots({ id, level, ctx }: { id: string; level: number; ctx: Ctx }) {
  const cols = [];
  for (let c = level + 1; c < ctx.widths.length; c++) {
    if (ctx.widths[c] === 0) continue;
    cols.push(
      <Slot
        key={c}
        width={ctx.widths[c]}
        label={c === level + 1 ? '+ respond' : '+ add'}
        title={`Write in ${ctx.columns[c].label}, in this row`}
        onClick={() => ctx.editor.respondAt(id, c)}
        testid={`respond-${c}`}
      />,
    );
  }
  return <div className="flex self-stretch" data-respond={id}>{cols}</div>;
}

const ALT_COLORS = ['#f59e0b', '#10b981', '#ec4899'];
function useRemoteOn(store: Store<PresenceState[]>, id: string) {
  const mine = useSettings((s) => s.color);
  const key = useStore(store, (list) =>
    list
      .map((p, i) => ({ ...p, color: p.color === mine ? ALT_COLORS[i % 3] : p.color }))
      .filter((p) => p.node === id)
      .map((p) => `${p.name}\u0001${p.color}`)
      .join('\u0002'),
  );
  return key ? key.split('\u0002').map((s) => s.split('\u0001')) : [];
}

function Cell({ id, n, level, ctx }: { id: string; n: Y.Map<any>; level: number; ctx: Ctx }) {
  const { editor } = ctx;
  const doc = editor.doc;
  const ref = useRef<HTMLTextAreaElement>(null);
  const ytext = n.get('text') as Y.Text;
  const focused = useStore(editor.focus, (f) => f.node === id);
  const remote = useRemoteOn(ctx.presence, id);
  const fontSize = useSettings((s) => s.fontSize);
  const width = ctx.widths[level];
  const mark: Mark | undefined = n.get('mark');
  const isExt = !!n.get('ext');

  const autosize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = ta.scrollHeight + 'px';
  };

  // text <-> Y.Text binding
  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.value = ytext.toString();
    autosize();
    const obs = (ev: Y.YTextEvent) => {
      const next = ytext.toString();
      if (ta.value === next) return;
      const isFocused = document.activeElement === ta;
      let s = ta.selectionStart;
      let e = ta.selectionEnd;
      if (isFocused) {
        // transform caret through the remote delta
        let pos = 0;
        for (const op of ev.delta) {
          if (op.retain) pos += op.retain;
          else if (op.insert) {
            const len = (op.insert as string).length;
            if (pos < s) s += len; // a tie means it landed after our own text: keep typing in our run
            if (pos < e) e += len;
            pos += len;
          } else if (op.delete) {
            const d = op.delete;
            if (pos < s) s -= Math.min(d, s - pos);
            if (pos < e) e -= Math.min(d, e - pos);
          }
        }
      }
      ta.value = next;
      if (isFocused) ta.setSelectionRange(s, e);
      autosize();
    };
    ytext.observe(obs);
    return () => ytext.unobserve(obs);
  }, [ytext]);

  useLayoutEffect(autosize, [width, fontSize]);

  useEffect(() => {
    const ta = ref.current;
    if (!focused || !ta) return;
    if (document.activeElement !== ta) {
      ta.focus({ preventScroll: true });
      const hint = editor.caretHint;
      if (hint === 'end') ta.setSelectionRange(ta.value.length, ta.value.length);
      else if (hint === 'start') ta.setSelectionRange(0, 0);
    }
    ta.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focused]);

  const ro = editor.readOnly;
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || ro) return;
    const ta = e.currentTarget;
    const mod = modKey(e);
    const k = e.key;
    const plain = !mod && !e.altKey && !e.shiftKey;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    // undo/redo (collaboration-aware: only undoes your own edits)
    if (mod && !e.altKey && k.toLowerCase() === 'z') {
      done();
      if (e.shiftKey) editor.undo.redo();
      else editor.undo.undo();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && k.toLowerCase() === 'y') return done(), void editor.undo.redo();
    if (plain && k === 'ArrowUp') return done(), void editor.focusAdjacent(id, 'up');
    if (plain && k === 'ArrowDown') return done(), void editor.focusAdjacent(id, 'down');
    if (plain && k === 'ArrowLeft') return done(), void editor.focusParent(id);
    if (plain && k === 'ArrowRight') {
      done();
      if (!editor.focusChild(id)) editor.respond(id);
      return;
    }
    if (k === 'Tab' && !mod && !e.altKey) return done(), void editor.focusSibling(id, e.shiftKey ? -1 : 1);
    if (k === 'Enter') {
      done();
      if (mod && e.shiftKey) return void editor.addSibling(id, 0);
      if (mod) return void editor.addSibling(id, 1);
      if (e.altKey && e.shiftKey) return void editor.addToParentsNext(id);
      if (e.shiftKey) return void editor.addChild(id);
      if (e.altKey) {
        if (isExt) return;
        if (!editor.focusSibling(id, -1, false)) editor.addSibling(id, 0);
        return;
      }
      if (!editor.focusSibling(id, 1, false)) editor.addSibling(id, 1);
      return;
    }
    if (k === 'Backspace' && !mod && !e.altKey) {
      if ((ta.value.length === 0 || isExt) && liveChildren(doc, id).length === 0) return done(), editor.remove(id);
      return;
    }
    if (k === 'Backspace' && mod) return done(), editor.remove(id);
    if (mod && !e.shiftKey && k.toLowerCase() === 'e') return done(), void editor.extend(id);
    if (mod && !e.shiftKey && k.toLowerCase() === 'b') return done(), editor.toggle(id, 'bold');
    if (mod && e.shiftKey && k.toLowerCase() === 'x') return done(), editor.toggle(id, 'crossed');
    if (e.altKey && !mod && !e.shiftKey && /^Digit[0-3]$/.test(e.nativeEvent.code)) {
      done();
      const m = ({ Digit1: 'dropped', Digit2: 'extended', Digit3: 'turned', Digit0: null } as Record<string, Mark | null>)[e.nativeEvent.code];
      editor.setMark(id, m);
      return;
    }
    if (k === 'Escape') {
      done();
      ta.blur();
      editor.blur();
    }
  };

  const chipColor = mark === 'dropped' ? 'var(--drop)' : mark === 'extended' ? 'var(--ext)' : 'var(--turn)';
  const siblings = liveChildren(doc, n.get('parent'));
  const isFirst = siblings[0] === id;

  return (
    <div
      className={cls('cell mx-1 my-[3px] px-2 py-[5px]', focused && 'focused', mark && `m-${mark}`, n.get('bold') && 'bold', n.get('crossed') && 'crossed')}
      onContextMenu={(e) => {
        e.preventDefault();
        if (ro) return;
        editor.setFocus(id, 'keep');
        ctx.menu.set({ x: e.clientX, y: e.clientY, id });
      }}
      data-cell={id}
    >
      {!isExt && !ro && (
        <div
          className="insert-line -top-[6px]"
          title="Insert cell above"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.addSibling(id, 0);
          }}
        />
      )}
      <div className="flex items-start gap-1">
        {isExt && <span className="t3 select-none" style={{ fontSize: 'var(--cell-font)', lineHeight: 1.45 }}>→</span>}
        <textarea
          ref={ref}
          rows={1}
          spellCheck={false}
          readOnly={isExt || ro}
          placeholder={isExt ? 'extended' : level === 0 && isFirst ? 'Type here…' : ''}
          onInput={(e) => {
            const ta = e.currentTarget;
            if (ta.value.includes('\n')) {
              const p = ta.selectionStart;
              ta.value = ta.value.replace(/\r?\n/g, ' ');
              ta.setSelectionRange(p, p);
            }
            setText(doc, ytext, ta.value);
            autosize();
          }}
          onFocus={() => {
            if (editor.focus.get().node !== id) editor.setFocus(id, 'keep');
          }}
          onBlur={() => {
            setTimeout(() => {
              if (editor.focus.get().node === id && document.activeElement !== ref.current) editor.blur();
            }, 0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {!ro && <div
        className="insert-line -bottom-[6px]"
        title="Insert cell below"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.addSibling(id, 1);
        }}
      />}
      {mark && (
        <span className="mark-chip" style={{ color: chipColor }}>
          {MARK_LABEL[mark]}
        </span>
      )}
      {remote.map(([name, color], i) => (
        <div key={i} style={{ ['--rc' as any]: color }}>
          <div className="remote-ring" />
          <div className="remote-tag">{name}</div>
        </div>
      ))}
    </div>
  );
}

function CellMenu({ ctx, x, y, id, onClose }: { ctx: Ctx; x: number; y: number; id: string; onClose: () => void }) {
  const { editor } = ctx;
  const n = getNode(editor.doc, id);
  if (!n) return null;
  const mark = n.get('mark');
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  const mk = (m: Mark, color: string, hint: string) => (
    <MenuItem onClick={run(() => editor.setMark(id, m))} hint={hint} active={mark === m}>
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {MARK_LABEL[m]}
    </MenuItem>
  );
  const M = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  const A = navigator.platform.includes('Mac') ? '⌥' : 'Alt+';
  return (
    <Menu x={x} y={y} onClose={onClose}>
      {mk('dropped', 'var(--drop)', `${A}1`)}
      {mk('extended', 'var(--ext)', `${A}2`)}
      {mk('turned', 'var(--turn)', `${A}3`)}
      {mark && (
        <MenuItem onClick={run(() => editor.setMark(id, null))} hint={`${A}0`}>
          Clear mark
        </MenuItem>
      )}
      <MenuSep />
      <MenuItem onClick={run(() => editor.addChild(id))} hint="⇧↵">
        Add response
      </MenuItem>
      <MenuItem onClick={run(() => editor.addSibling(id, 0))} hint={`${M}⇧↵`}>
        Insert above
      </MenuItem>
      <MenuItem onClick={run(() => editor.addSibling(id, 1))} hint={`${M}↵`}>
        Insert below
      </MenuItem>
      <MenuItem onClick={run(() => editor.extend(id))} hint={`${M}E`}>
        Extend →
      </MenuItem>
      <MenuSep />
      <MenuItem onClick={run(() => editor.toggle(id, 'bold'))} hint={`${M}B`} active={!!n.get('bold')}>
        Bold
      </MenuItem>
      <MenuItem onClick={run(() => editor.toggle(id, 'crossed'))} hint={`${M}⇧X`} active={!!n.get('crossed')}>
        Cross out
      </MenuItem>
      <MenuSep />
      <MenuItem danger onClick={run(() => editor.remove(id))} hint={`${M}⌫`}>
        Delete cell{liveChildren(editor.doc, id).length ? ' + responses' : ''}
      </MenuItem>
    </Menu>
  );
}
