import { useState } from 'react';
import * as Y from 'yjs';
import type { FlowEditor } from '../lib/editor';
import { CALL_LABEL, CALL_STATUSES, type CallStatus } from '../lib/evidence';
import { levelOf, liveChildren, nodesMap, rootOf, sheetsMap } from '../lib/model';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { DockFrame } from './Dock';
import { Icon } from './ui';

interface CallItem {
  id: string;
  text: string;
  note: string;
  status: CallStatus;
  col: string;
}

/** Marked cells of a tab, in grid order (top to bottom, left to right within a row). */
function callsInSheet(editor: FlowEditor, sheet: string): CallItem[] {
  const d = editor.doc;
  const cols = editor.columns(sheet);
  const out: CallItem[] = [];
  const walk = (id: string) => {
    const n = nodesMap(d).get(id);
    if (!n) return;
    const st = n.get('call') as CallStatus | undefined;
    if (st) {
      const note = n.get('callNote');
      out.push({
        id,
        text: String(n.get('text') ?? '').trim(),
        note: note instanceof Y.Text ? note.toString().trim() : '',
        status: st,
        col: cols[levelOf(d, id)]?.short ?? '',
      });
    }
    for (const c of liveChildren(d, id)) walk(c);
  };
  for (const r of liveChildren(d, rootOf(sheet))) walk(r);
  return out;
}

const PREF = 'pf.evidence.filters';
function loadPrefs(): { status: CallStatus | null; hideChecked: boolean } {
  try {
    return { status: null, hideChecked: false, ...JSON.parse(sessionStorage.getItem(PREF) || '{}') };
  } catch {
    return { status: null, hideChecked: false };
  }
}

export function EvidencePanel({ editor, onClose }: { editor: FlowEditor; onClose: () => void }) {
  const doc = editor.doc;
  useY(nodesMap(doc), true);
  useY(sheetsMap(doc), true);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const setPrefs = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    sessionStorage.setItem(PREF, JSON.stringify(next));
  };
  const groups = editor.sheets().map((s) => ({
    sheet: s,
    name: sheetsMap(doc).get(s)?.get('name') ?? 'Tab',
    items: callsInSheet(editor, s).filter((it) => (!prefs.status || it.status === prefs.status) && !(prefs.hideChecked && it.status === 'checked')),
  }));
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const anyMarked = editor.sheets().some((s) => callsInSheet(editor, s).length > 0);

  return (
    <DockFrame
      title="Evidence calls"
      onClose={onClose}
      testid="evidence"
      actions={
        <label className="t2 flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[12px]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={prefs.hideChecked} onChange={(e) => setPrefs({ hideChecked: e.target.checked })} data-testid="hide-checked" />
          Hide Checked
        </label>
      }
    >
      <div className="flex gap-1 border-b bd px-3 py-2" data-testid="call-filter">
        {([null, ...CALL_STATUSES] as (CallStatus | null)[]).map((s) => (
          <button
            key={s ?? 'all'}
            className={cls('rounded-full border px-2.5 py-0.5 text-[12px]', prefs.status === s ? 'font-semibold' : 't2 bd hover:bg-[var(--hover-bg)]', prefs.status === s && s && `call-pill call-${s} border-transparent`)}
            style={prefs.status === s && !s ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => setPrefs({ status: s })}
            data-testid={`filter-${s ?? 'all'}`}
          >
            {s ? CALL_LABEL[s] : 'All'}
          </button>
        ))}
      </div>
      <div className="px-2 py-2">
        {total === 0 && (
          <div className="t3 px-3 py-10 text-center text-[12.5px] leading-relaxed">
            {anyMarked ? (
              'Nothing matches these filters.'
            ) : (
              <>
                No evidence calls yet.
                <br />
                Select a cell and press Alt+4 (or right-click → Call evidence) to flag a card you want to call.
              </>
            )}
          </div>
        )}
        {groups.map((g) =>
          g.items.length ? (
            <section key={g.sheet} className="mb-2" data-testid="ev-tab">
              <div className="t3 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide">{g.name}</div>
              {g.items.map((it) => (
                <div
                  key={it.id}
                  className="group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover-bg)]"
                  onClick={() => editor.reveal(it.id)}
                  title="Jump to the cell"
                  data-testid="ev-item"
                  data-status={it.status}
                >
                  <button
                    className={cls('call-pill mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', `call-${it.status}`)}
                    onClick={(e) => {
                      e.stopPropagation();
                      editor.cycleCall(it.id);
                    }}
                    title={`${CALL_LABEL[it.status]}: click to change`}
                    data-testid="ev-status"
                  >
                    {it.status === 'checked' ? <Icon.check s={10} /> : it.status === 'called' ? <Icon.send s={10} /> : <Icon.card s={10} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[13px] leading-snug">
                      <span className="t3 mr-1.5 font-mono text-[10.5px]">{it.col}</span>
                      {it.text || <span className="t3">(empty cell)</span>}
                    </div>
                    {it.note && <div className="t2 mt-0.5 line-clamp-2 text-[12px] italic">{it.note}</div>}
                  </div>
                  <span className={cls('mt-0.5 shrink-0 text-[11px] font-medium', it.status === 'todo' ? 'text-[var(--call)]' : it.status === 'called' ? 'text-[var(--call-called)]' : 'text-[var(--call-checked)]')}>
                    {CALL_LABEL[it.status]}
                  </span>
                </div>
              ))}
            </section>
          ) : null,
        )}
      </div>
    </DockFrame>
  );
}
