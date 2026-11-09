import { useEffect, useLayoutEffect, useRef } from 'react';
import * as Y from 'yjs';
import { setText, type Mode } from '../lib/model';
import { ensureRoundFields, readSummary, roundMap, roundText, setRoundValue, RESULT_LABEL, type Result, type TextField } from '../lib/round';
import { DockFrame } from './Dock';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';

function YField({ doc, field, multiline, placeholder }: { doc: Y.Doc; field: TextField; multiline?: boolean; placeholder?: string }) {
  return <YTextInput doc={doc} ytext={roundText(doc, field)} multiline={multiline} placeholder={placeholder} testid={field} />;
}

/** A text input/textarea bound to a shared Y.Text (character-level merge, caret kept on remote edits). */
export function YTextInput(props: {
  doc: Y.Doc;
  ytext: Y.Text;
  multiline?: boolean;
  placeholder?: string;
  testid?: string;
  className?: string;
  minHeight?: number;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const { doc, ytext, multiline } = props;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const autosize = () => {
    const el = ref.current;
    if (!el || !multiline) return;
    el.style.height = '0px';
    el.style.height = Math.max(props.minHeight ?? 76, el.scrollHeight) + 'px';
  };
  useLayoutEffect(() => {
    const el = ref.current!;
    el.value = ytext.toString();
    autosize();
    const obs = (ev: Y.YTextEvent) => {
      const next = ytext.toString();
      if (el.value === next) return;
      const focused = document.activeElement === el;
      let s = el.selectionStart ?? 0;
      let e = el.selectionEnd ?? 0;
      if (focused) {
        let pos = 0;
        for (const op of ev.delta) {
          if (op.retain) pos += op.retain;
          else if (op.insert) {
            const len = (op.insert as string).length;
            if (pos < s) s += len; // a tie means it landed after our own text: keep typing in our run
            if (pos < e) e += len;
            pos += len;
          } else if (op.delete) {
            if (pos < s) s -= Math.min(op.delete, s - pos);
            if (pos < e) e -= Math.min(op.delete, e - pos);
          }
        }
      }
      el.value = next;
      if (focused) el.setSelectionRange(s, e);
      autosize();
    };
    ytext.observe(obs);
    if (props.autoFocus) setTimeout(() => el.focus(), 0);
    return () => ytext.unobserve(obs);
  }, [ytext]);
  const p = {
    ref,
    placeholder: props.placeholder,
    spellCheck: !!multiline,
    style: props.style,
    className: props.className ?? cls('input', multiline && 'resize-none leading-relaxed'),
    onInput: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(doc, ytext, e.currentTarget.value);
      autosize();
    },
    onKeyDown: props.onKeyDown,
    'data-field': props.testid,
  };
  return multiline ? <textarea {...p} rows={3} /> : <input {...p} />;
}

function Segmented<T extends string>(props: { value: T | ''; options: { value: T; label: string; color?: string }[]; onChange: (v: T | null) => void; allowClear?: boolean; testid?: string }) {
  return (
    <div className="flex rounded-lg border bd p-0.5 text-[12.5px] font-medium" data-testid={props.testid}>
      {props.options.map((o) => {
        const on = props.value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={cls('flex-1 rounded-md px-2.5 py-1.5 transition-colors', on ? (o.color ? 'text-white' : 'bg-[var(--panel-2)]') : 't2 hover:bg-[var(--hover-bg)]')}
            style={on && o.color ? { background: o.color } : undefined}
            onClick={() => props.onChange(on && props.allowClear ? null : o.value)}
            title={on && props.allowClear ? 'Click again to clear' : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="t2 mb-1.5 text-[12px] font-medium">{children}</div>;
}

export function RoundInfoPanel(props: { doc: Y.Doc; mode: Mode; onModeChange: (m: Mode) => void; onClose: () => void }) {
  const { doc } = props;
  const rm = roundMap(doc);
  useY(rm);
  const side = (rm.get('side') as 'aff' | 'con') || '';
  const result = (rm.get('result') as Result) || '';
  useEffect(() => ensureRoundFields(doc), [doc]);
  return (
    <DockFrame title="Round info" onClose={props.onClose} testid="round-info" footer={<div className="t3 px-5 py-2.5 text-[11.5px]">Synced live with your partner.</div>}>
      <div className="space-y-4 px-5 py-4">
        <div>
          <Label>Opponent</Label>
          <YField doc={doc} field="opponent" placeholder="School and/or names" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tournament</Label>
            <YField doc={doc} field="tournament" placeholder="e.g. Harvard" />
          </div>
          <div>
            <Label>Round</Label>
            <YField doc={doc} field="round" placeholder="e.g. R3, Quarters" />
          </div>
        </div>
        <div>
          <Label>Judge</Label>
          <YField doc={doc} field="judge" placeholder="Name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>My side</Label>
            <Segmented
              testid="my-side"
              value={side}
              allowClear
              options={[
                { value: 'aff', label: 'Aff', color: 'var(--aff)' },
                { value: 'con', label: 'Con', color: 'var(--con)' },
              ]}
              onChange={(v) => setRoundValue(doc, 'side', v)}
            />
          </div>
          <div>
            <Label>Speaking order</Label>
            <Segmented
              testid="speaking-order"
              value={props.mode}
              options={[
                { value: 'aff', label: 'Aff first' },
                { value: 'con', label: 'Con first' },
              ]}
              onChange={(v) => v && props.onModeChange(v)}
            />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <Label>Result</Label>
            <Segmented
              testid="result"
              value={result}
              allowClear
              options={[
                { value: 'win', label: 'Win', color: '#059669' },
                { value: 'loss', label: 'Loss', color: '#dc2626' },
                { value: 'pending', label: 'Pending', color: '#6b7280' },
              ]}
              onChange={(v) => setRoundValue(doc, 'result', v)}
            />
          </div>
          <div>
            <Label>Speaker points</Label>
            <YField doc={doc} field="speaks" placeholder="28.5 / 28.7" />
          </div>
        </div>
        <div>
          <Label>Ballot notes</Label>
          <YField doc={doc} field="ballotNotes" multiline placeholder="RFD, what the ballot said…" />
        </div>
        <div>
          <Label>Judge feedback</Label>
          <YField doc={doc} field="feedback" multiline placeholder="Oral feedback, things to fix…" />
        </div>
      </div>
    </DockFrame>
  );
}

/** Compact summary for the flow header button, e.g. "vs Lincoln · R3 · Win". */
export function RoundInfoSummary({ doc }: { doc: Y.Doc }) {
  useY(roundMap(doc), true);
  const s = readSummary(doc);
  const parts = [s.opponent && `vs ${s.opponent}`, s.round, s.result && RESULT_LABEL[s.result]].filter(Boolean);
  return <span className="min-w-0 max-w-[240px] truncate">{parts.length ? parts.join(' · ') : 'Round info'}</span>;
}
