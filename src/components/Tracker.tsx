import { useState } from 'react';
import * as Y from 'yjs';
import type { FlowEditor } from '../lib/editor';
import { liveChildren, meta, nodesMap, rootOf, sheetsMap, type Mark } from '../lib/model';
import { LOCAL } from '../lib/sync';
import { analyzeSheet, visibleArgs, type Chip, type TItem, type TNode, type TSheet } from '../lib/tracker';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { DockFrame } from './Dock';
import { YTextInput } from './RoundInfo';

// ---------- live doc -> analyzer input ----------
function toTree(doc: Y.Doc, id: string): TNode | null {
  const n = nodesMap(doc).get(id);
  if (!n) return null;
  return {
    id,
    text: String(n.get('text') ?? ''),
    mark: (n.get('mark') as Mark) ?? null,
    ext: !!n.get('ext'),
    empty: !!n.get('empty'),
    children: liveChildren(doc, id)
      .map((c) => toTree(doc, c))
      .filter(Boolean) as TNode[],
  };
}
export function sheetForTracker(editor: FlowEditor, sheetId: string): TSheet {
  const doc = editor.doc;
  return {
    id: sheetId,
    name: sheetsMap(doc).get(sheetId)?.get('name') ?? 'Tab',
    columns: editor.columns(sheetId).map((c) => ({ key: c.key, side: c.side })),
    roots: liveChildren(doc, rootOf(sheetId))
      .map((r) => toTree(doc, r))
      .filter(Boolean) as TNode[],
  };
}

// ---------- shared checklist state ----------
// Flat keys ("<cellId>:sum", "<cellId>:ff", "<cellId>:note") so two people ticking/typing the same
// item at once (even offline) never replace each other's data.
const trackerMap = (d: Y.Doc) => d.getMap<any>('tracker2');
const key = (id: string, f: 'sum' | 'ff' | 'note') => `${id}:${f}`;
function noteText(d: Y.Doc, id: string): Y.Text {
  const m = trackerMap(d);
  if (!(m.get(key(id, 'note')) instanceof Y.Text)) d.transact(() => m.set(key(id, 'note'), new Y.Text()), LOCAL);
  return m.get(key(id, 'note'));
}

const SPEECH_LABEL = { R: 'Reb', S: 'Sum', F: 'FF' } as const;
const SPEECH_FULL = { R: 'Rebuttal', S: 'Summary', F: 'Final Focus' } as const;

function ChipView({ c, editor }: { c: Chip; editor: FlowEditor }) {
  const title =
    c.state === 'na'
      ? `${SPEECH_FULL[c.speech]}: not on this tab / not after this`
      : c.state === 'extended'
        ? `Extended in ${SPEECH_FULL[c.speech]}`
        : c.state === 'present'
          ? `${SPEECH_FULL[c.speech]}: written but not marked Extended`
          : `Not in ${SPEECH_FULL[c.speech]}`;
  return (
    <button
      className={cls('trk-chip', `trk-${c.state}`, c.gap && 'trk-gap')}
      title={c.gap ? `Gap: extended earlier but ${c.state === 'present' ? 'not marked extended' : 'missing'} in ${SPEECH_FULL[c.speech]}` : title}
      disabled={!c.nodeId}
      onClick={(e) => {
        e.stopPropagation();
        if (c.nodeId) editor.reveal(c.nodeId);
      }}
      data-state={c.state}
      data-gap={c.gap || undefined}
    >
      {c.gap && '! '}
      {SPEECH_LABEL[c.speech]}
    </button>
  );
}

function ItemRow({ it, editor, small }: { it: TItem; editor: FlowEditor; small?: boolean }) {
  const doc = editor.doc;
  const tm = trackerMap(doc);
  useY(tm);
  const note = tm.get(key(it.id, 'note'));
  useY(note instanceof Y.Text ? note : null);
  const [noteOpen, setNoteOpen] = useState(false);
  const hasNote = note instanceof Y.Text && note.length > 0;
  const toggle = (k: 'sum' | 'ff') => doc.transact(() => tm.set(key(it.id, k), !tm.get(key(it.id, k))), LOCAL);
  const sideColor = it.side === 'aff' ? 'var(--aff)' : 'var(--con)';
  return (
    <div className={cls('rounded-lg py-1.5', small ? 'pl-3' : 'pl-2')} data-testid={small ? 'trk-response' : 'trk-arg'} data-item={it.id}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-3.5 w-1 shrink-0 rounded-full" style={{ background: sideColor }} />
        <button className={cls('min-w-0 flex-1 text-left leading-snug hover:underline', small ? 't2 text-[12.5px]' : 'text-[13px] font-medium')} onClick={() => editor.reveal(it.id)} title="Jump to this cell">
          <span className="line-clamp-2">{it.text}</span>
        </button>
      </div>
      <div className="ml-3 mt-1 flex flex-wrap items-center gap-1">
        {it.chips.map((c) => (
          <ChipView key={c.speech} c={c} editor={editor} />
        ))}
        <span className="ml-auto flex items-center gap-2 pr-1 text-[11.5px]">
          <span className="t3">Covered:</span>
          <label className="t2 flex cursor-pointer items-center gap-1" title="I covered this in my Summary">
            <input type="checkbox" className="accent-[var(--accent)]" checked={!!tm.get(key(it.id, 'sum'))} onChange={() => toggle('sum')} data-testid="chk-sum" />
            Sum
          </label>
          <label className="t2 flex cursor-pointer items-center gap-1" title="I covered this in my Final Focus">
            <input type="checkbox" className="accent-[var(--accent)]" checked={!!tm.get(key(it.id, 'ff'))} onChange={() => toggle('ff')} data-testid="chk-ff" />
            FF
          </label>
          <button className={cls('btn !px-1 !py-0 text-[11.5px]', hasNote ? 'text-[var(--accent)]' : 't3')} onClick={() => {
              if (!noteOpen) noteText(doc, it.id);
              setNoteOpen(!noteOpen);
            }} title="Add a short note" data-testid="note-btn">
            note
          </button>
        </span>
      </div>
      {(noteOpen || hasNote) && note instanceof Y.Text && (
        <div className="ml-3 mt-1 pr-1">
          <YTextInput doc={doc} ytext={note} placeholder="Short note…" className="input !py-1 text-[12px]" testid="trk-note" autoFocus={noteOpen && !hasNote} />
        </div>
      )}
    </div>
  );
}

export function TrackerPanel({ editor, onClose }: { editor: FlowEditor; onClose: () => void }) {
  const doc = editor.doc;
  useY(nodesMap(doc), true);
  useY(sheetsMap(doc), true);
  useY(meta(doc));
  const [showAll, setShowAll] = useState(() => sessionStorage.getItem('pf.trk.all') === '1');
  const sheets = editor.sheets();
  const results = sheets.map((s) => {
    const res = analyzeSheet(sheetForTracker(editor, s));
    return { res, shown: visibleArgs(res, showAll) };
  });
  const total = results.reduce((a, r) => a + r.shown.length, 0);
  return (
    <DockFrame
      title="Drop/extend tracker"
      onClose={onClose}
      testid="tracker"
      actions={
        <label className="t2 flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[12px]" title="Also list arguments that were never extended">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              sessionStorage.setItem('pf.trk.all', e.target.checked ? '1' : '0');
            }}
            data-testid="trk-all"
          />
          Show all
        </label>
      }
      footer={
        <div className="t3 flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 text-[11px]">
          <span><span className="trk-chip trk-extended">Sum</span> extended</span>
          <span><span className="trk-chip trk-present">Sum</span> written, not marked</span>
          <span><span className="trk-chip trk-missing">Sum</span> missing</span>
          <span><span className="trk-chip trk-missing trk-gap">! Sum</span> gap</span>
        </div>
      }
    >
      <div className="px-3 py-2">
        {total === 0 && (
          <div className="t3 px-2 py-10 text-center text-[12.5px] leading-relaxed">
            {showAll ? 'Nothing on the flow yet.' : 'Nothing extended yet.'}
            <br />
            Mark cells Extended (Alt+2) or Dropped (Alt+1) as the round goes; arguments show up here once they’re extended.
          </div>
        )}
        {results.map(({ res, shown }) =>
          shown.length ? (
            <section key={res.sheetId} className="mb-3" data-testid="trk-tab">
              <div className="t3 sticky top-0 z-[1] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--panel)' }}>
                {res.name}
              </div>
              <div className="space-y-1">
                {shown.map((a) => (
                  <div key={a.id} className={cls('rounded-lg border bd', a.hasGap && 'border-[color-mix(in_srgb,var(--drop)_45%,transparent)]')}>
                    <ItemRow it={a} editor={editor} />
                    {a.responses.length > 0 && (
                      <div className="ml-3 border-l bd pb-1">
                        {a.responses.map((r) => (
                          <ItemRow key={r.id} it={r} editor={editor} small />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </DockFrame>
  );
}
