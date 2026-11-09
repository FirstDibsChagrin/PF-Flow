import { useEffect, useRef, useState } from 'react';
import type { FlowEditor } from '../lib/editor';
import { addExt, deleteExt, ensureExt, extItems, extRoot, extText, homeFingerprint, listExt, moveExt, templateRef } from '../lib/ext';
import { meta, type Side } from '../lib/model';
import { createTemplate, entriesMap, homeCode, homeIndex, pushExtToTemplate } from '../lib/room';
import { roundMap } from '../lib/round';
import { patchSettings, useSettings } from '../lib/settings';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { DockFrame } from './Dock';
import { YTextInput } from './RoundInfo';
import { confirmDialog, Icon, promptDialog, toast } from './ui';

type Version = 'summary' | 'ff';

export function ExtensionsPanel({ editor, kind, onClose }: { editor: FlowEditor; kind: 'flow' | 'template'; onClose: () => void }) {
  const doc = editor.doc;
  useEffect(() => ensureExt(doc), [doc]);
  useY(extRoot(doc), true);
  const rm = roundMap(doc);
  useY(rm);
  const sideKey = `pf.extSide.${editor.room}${editor.id}`;
  const [side, setSide] = useState<Side>(() => (sessionStorage.getItem(sideKey) as Side) || (rm.get('side') as Side) || 'aff');
  useEffect(() => sessionStorage.setItem(sideKey, side), [side]);
  const ids = listExt(doc, side);
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState<Version>('summary');
  const readSize = useSettings((s) => s.readFontSize);
  const items = extItems(doc);
  const selected = sel && ids.includes(sel) ? sel : ids[0] ?? null;

  // opening the panel shouldn't leave the keyboard in a grid cell
  useEffect(() => {
    editor.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  // panel keyboard: ↑/↓ (or J/K) move, Enter/Space open/close, S/F switch version, E edit, Esc back
  const state = useRef({ ids, selected, open, editing });
  state.current = { ids, selected, open, editing };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (document.querySelector('.fixed.inset-0.z-50')) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const st = state.current;
      if (e.key === 'Escape') {
        if (st.editing) {
          setEditing(false);
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else if (st.open) setOpen(null);
        else return; // let the dock close
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (typing || t.closest('[data-cell]') || e.altKey || e.metaKey || e.ctrlKey) return;
      const i = st.selected ? st.ids.indexOf(st.selected) : -1;
      const go = (j: number) => {
        const id = st.ids[Math.max(0, Math.min(st.ids.length - 1, j))];
        if (!id) return;
        setSel(id);
        if (st.open) setOpen(id);
        document.querySelector(`[data-ext="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      const handled = (() => {
        if (e.key === 'ArrowDown' || e.key === 'j') return go(i + 1), true;
        if (e.key === 'ArrowUp' || e.key === 'k') return go(i - 1), true;
        if ((e.key === 'Enter' || e.key === ' ') && st.selected) return setOpen(st.open ? null : st.selected), true;
        if (e.key === 's' && st.open) return setVersion('summary'), true;
        if (e.key === 'f' && st.open) return setVersion('ff'), true;
        if (e.key === 'e' && st.open) return setEditing(true), true;
        return false;
      })();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  const add = () => {
    const id = addExt(doc, side);
    setSel(id);
    setOpen(id);
    setEditing(true);
  };
  const remove = async (id: string) => {
    const title = String(extText(doc, id, 'title') ?? '') || 'this extension';
    if (!(await confirmDialog(`Delete “${title}”?`, 'It is removed for both of you.', 'Delete', true))) return;
    deleteExt(doc, side, id);
    if (open === id) setOpen(null);
  };

  const titleOf = (id: string) => String(extText(doc, id, 'title') ?? '').trim();
  const firstLine = (id: string) => String(extText(doc, id, 'summary') ?? '').trim().split('\n')[0] || String(extText(doc, id, 'ff') ?? '').trim().split('\n')[0];

  const reading = open && items?.has(open) ? open : null;

  return (
    <DockFrame
      title={
        <div className="flex items-center gap-2">
          <span>Extensions</span>
          <div className="flex rounded-lg border bd p-0.5 text-[12px] font-medium" data-testid="ext-side">
            {(['aff', 'con'] as Side[]).map((s) => (
              <button
                key={s}
                className={cls('rounded-md px-2.5 py-0.5', side === s ? 'text-white' : 't2')}
                style={side === s ? { background: s === 'aff' ? 'var(--aff)' : 'var(--con)' } : undefined}
                onClick={() => {
                  setSide(s);
                  setOpen(null);
                  setEditing(false);
                }}
              >
                {s === 'aff' ? 'Aff' : 'Con'}
              </button>
            ))}
          </div>
        </div>
      }
      onClose={onClose}
      width={reading ? 580 : 400}
      testid="extensions"
      actions={
        reading ? (
          <div className="flex items-center gap-0.5" title="Reading text size (this device)">
            <button className="btn !px-1.5 !py-0.5 text-[12px]" onClick={() => patchSettings({ readFontSize: Math.max(16, readSize - 2) })} data-testid="read-smaller">
              A−
            </button>
            <span className="t3 w-7 text-center text-[11px]">{readSize}</span>
            <button className="btn !px-1.5 !py-0.5 text-[14px]" onClick={() => patchSettings({ readFontSize: Math.min(48, readSize + 2) })} data-testid="read-bigger">
              A+
            </button>
          </div>
        ) : (
          <button className="btn btn-outline !py-1" onClick={add} data-testid="add-ext">
            <Icon.plus s={14} /> Add extension
          </button>
        )
      }
      footer={<ExtFooter editor={editor} kind={kind} />}
    >
      {reading ? (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b bd px-3 py-2">
            <button className="btn t2 !px-2" onClick={() => (setOpen(null), setEditing(false))} title="Back to the list (Esc)">
              <Icon.back /> All
            </button>
            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{titleOf(reading) || 'Untitled extension'}</div>
            {!editing && (
              <div className="flex rounded-lg border bd p-0.5 text-[12.5px] font-medium" data-testid="ext-version">
                {(
                  [
                    ['summary', 'Summary'],
                    ['ff', 'Final Focus'],
                  ] as [Version, string][]
                ).map(([v, l]) => (
                  <button key={v} className={cls('rounded-md px-2.5 py-1', version === v ? 'bg-[var(--panel-2)] font-semibold' : 't2')} onClick={() => setVersion(v)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <button className={cls('btn !px-2', editing ? 'btn-primary' : 'btn-outline')} onClick={() => setEditing(!editing)} data-testid="ext-edit">
              {editing ? 'Done' : <><Icon.edit /> Edit</>}
            </button>
          </div>
          {editing ? (
            <div className="space-y-3 p-4" data-testid="ext-editor">
              <div>
                <div className="t2 mb-1 text-[12px] font-medium">Title (optional)</div>
                <YTextInput doc={doc} ytext={extText(doc, reading, 'title')!} placeholder="e.g. C1 economy" testid="ext-title" autoFocus />
              </div>
              <div>
                <div className="t2 mb-1 text-[12px] font-medium">Summary version</div>
                <YTextInput doc={doc} ytext={extText(doc, reading, 'summary')!} multiline minHeight={140} placeholder="What you say in Summary…" testid="ext-summary" />
              </div>
              <div>
                <div className="t2 mb-1 text-[12px] font-medium">Final Focus version</div>
                <YTextInput doc={doc} ytext={extText(doc, reading, 'ff')!} multiline minHeight={110} placeholder="What you say in Final Focus…" testid="ext-ff" />
              </div>
            </div>
          ) : (
            <ReadView text={String(extText(doc, reading, version) ?? '')} size={readSize} empty={version === 'summary' ? 'No Summary version yet. Press E to write one.' : 'No Final Focus version yet. Press E to write one.'} />
          )}
        </div>
      ) : (
        <div className="p-2" data-testid="ext-list">
          {ids.length === 0 && (
            <div className="t3 px-3 py-10 text-center text-[12.5px] leading-relaxed">
              No {side === 'aff' ? 'Aff' : 'Con'} extensions yet.
              <br />
              Add the extensions you read for your own constructive.
              <div className="mt-4">
                <button className="btn btn-primary" onClick={add}>
                  <Icon.plus s={14} /> Add extension
                </button>
              </div>
            </div>
          )}
          {ids.map((id, i) => (
            <div
              key={id}
              data-ext={id}
              className={cls('group flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--hover-bg)]', selected === id && 'bg-[var(--focus-bg)]')}
              onClick={() => {
                setSel(id);
                setOpen(id);
                setEditing(false);
              }}
              data-testid="ext-item"
            >
              <span className="t3 mt-0.5 w-4 shrink-0 text-right font-mono text-[11px]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{titleOf(id) || firstLine(id) || 'Untitled extension'}</div>
                {titleOf(id) && firstLine(id) && <div className="t3 truncate text-[12px]">{firstLine(id)}</div>}
              </div>
              <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                <button className="btn !p-1" title="Move up" onClick={() => moveExt(doc, side, id, -1)} disabled={i === 0}>
                  <Icon.up />
                </button>
                <button className="btn !p-1" title="Move down" onClick={() => moveExt(doc, side, id, 1)} disabled={i === ids.length - 1}>
                  <Icon.down />
                </button>
                <button className="btn !p-1 text-red-500" title="Delete" onClick={() => remove(id)}>
                  <Icon.trash />
                </button>
              </div>
            </div>
          ))}
          {ids.length > 0 && <div className="t3 px-3 pt-3 text-[11px]">↑/↓ select · Enter open · S/F switch version · E edit · Esc back</div>}
        </div>
      )}
    </DockFrame>
  );
}

function ReadView({ text, size, empty }: { text: string; size: number; empty: string }) {
  return (
    <div className="px-6 py-5" data-testid="ext-read">
      {text.trim() ? (
        <div className="whitespace-pre-wrap break-words font-medium" style={{ fontSize: size, lineHeight: 1.55, letterSpacing: '0.005em' }}>
          {text}
        </div>
      ) : (
        <div className="t3 text-[14px]">{empty}</div>
      )}
    </div>
  );
}

/** Template link: push this flow's extensions back to its template, or save as a new template. */
function ExtFooter({ editor, kind }: { editor: FlowEditor; kind: 'flow' | 'template' }) {
  const doc = editor.doc;
  useY(meta(doc));
  useY(entriesMap(homeIndex().doc));
  const ref = templateRef(doc);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!ref) return setMine(false);
    homeFingerprint(homeCode()).then((fp) => alive && setMine(fp === ref.owner && entriesMap(homeIndex().doc).has(ref.id)));
    return () => {
      alive = false;
    };
  }, [ref?.id, ref?.owner]);
  if (kind === 'template') return <div className="t3 px-4 py-2.5 text-[11.5px]">Extensions here are copied into every flow made from this template.</div>;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      {mine && ref ? (
        <>
          <span className="t3 min-w-0 flex-1 truncate text-[11.5px]">From template “{ref.name}”</span>
          <button
            className="btn btn-outline !py-1"
            data-testid="push-template"
            onClick={async () => {
              const ok = await confirmDialog(
                'Push extensions to the template?',
                `This overwrites all extensions in “${ref.name}” with this flow's extensions (Aff and Con). Other flows you already made from it don't change.`,
                'Push changes',
              );
              if (!ok) return;
              await pushExtToTemplate(doc, ref.id);
              toast(`Template “${ref.name}” updated`);
            }}
          >
            Push changes to template
          </button>
        </>
      ) : (
        <>
          <span className="t3 min-w-0 flex-1 text-[11.5px]">{ref ? `Made from your partner's template “${ref.name}”.` : 'Not made from a template.'}</span>
          <button
            className="btn btn-outline !py-1"
            data-testid="ext-save-template"
            onClick={async () => {
              const name = await promptDialog('Save as template', `${meta(doc).get('name') ?? 'Flow'} template`, 'Save template');
              if (!name) return;
              await createTemplate({ name, mode: meta(doc).get('mode') || 'aff', from: { room: editor.room, doc: editor.id } });
              toast('Saved to your Templates, with these extensions');
            }}
          >
            Save as template
          </button>
        </>
      )}
    </div>
  );
}
