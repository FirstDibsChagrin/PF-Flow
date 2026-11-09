import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FlowEditor } from '../lib/editor';
import { chatArray, markRead, sendChat, type ChatMsg } from '../lib/chat';
import { getNode, levelOf, sheetsMap } from '../lib/model';
import { partnerColor, useSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { clientKey } from '../lib/sync';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { DockFrame } from './Dock';
import { Icon } from './ui';


function cellLabel(editor: FlowEditor, id: string): string | null {
  const n = getNode(editor.doc, id);
  if (!n) return null;
  const sheet = sheetsMap(editor.doc).get(n.get('sheet'));
  const col = editor.columns(n.get('sheet'))[levelOf(editor.doc, id)];
  const text = String(n.get('text') ?? '').trim();
  return `${sheet?.get('name') ?? '?'} · ${col?.short ?? ''}${text ? ` · “${text.length > 40 ? text.slice(0, 40) + '…' : text}”` : ''}`;
}

export function ChatPanel({ editor, onClose }: { editor: FlowEditor; onClose: () => void }) {
  const doc = editor.doc;
  const arr = chatArray(doc);
  useY(arr);
  const msgs = arr.toArray();
  const meName = useSettings((s) => s.name);
  const meColor = useSettings((s) => s.color);
  const lastCell = useStore(editor.lastCell);
  const target = useStore(editor.chatTarget);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachable = lastCell && getNode(doc, lastCell) ? lastCell : null;

  // reading the panel marks everything read
  useEffect(() => {
    markRead(editor.room);
  }, [msgs.length]);
  useEffect(() => () => markRead(editor.room), []);

  // scroll to the newest message, or to the one opened from a cell marker
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (target) {
      el.querySelector(`[data-msg="${target}"]`)?.scrollIntoView({ block: 'center' });
      const t = setTimeout(() => editor.chatTarget.set(null), 2200);
      return () => clearTimeout(t);
    }
    el.scrollTop = el.scrollHeight;
  }, [msgs.length, target]);

  useEffect(() => {
    if (!target) inputRef.current?.focus();
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendChat(doc, { by: meName || 'Someone', color: meColor, text: t, cell: attach ? attachable : null });
    setText('');
    setAttach(false);
  };

  const colorOf = (m: ChatMsg, _i: number) => (m.client !== clientKey ? partnerColor(m.color, meColor, m.client) : m.color);

  return (
    <DockFrame
      title="Partner chat"
      onClose={onClose}
      testid="chat"
      footer={
        <div className="space-y-2 p-3">
          {attachable && (
            <label className="t2 flex cursor-pointer items-center gap-2 text-[12px]" data-testid="attach">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="accent-[var(--accent)]" />
              <span className="min-w-0 truncate">Attach to cell: {cellLabel(editor, attachable)}</span>
            </label>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              className="input max-h-40 resize-none !py-2 leading-snug"
              placeholder="Message your partner… (Enter to send)"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = '0px';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                  (e.target as HTMLTextAreaElement).style.height = '';
                }
              }}
              data-testid="chat-input"
            />
            <button className="btn btn-primary !py-2" onClick={send} disabled={!text.trim()}>
              Send
            </button>
          </div>
        </div>
      }
    >
      <div ref={listRef} className="h-full overflow-auto px-3 py-3" data-testid="chat-list">
        {msgs.length === 0 && (
          <div className="t3 px-2 py-10 text-center text-[12.5px] leading-relaxed">
            Only people in this flow can see this chat.
            <br />
            Select a cell first to attach a message to it.
          </div>
        )}
        {msgs.map((m, i) => {
          const mine = m.client === clientKey;
          const prev = msgs[i - 1];
          const grouped = prev && prev.client === m.client && m.at - prev.at < 120_000;
          const label = m.cell ? cellLabel(editor, m.cell) : null;
          return (
            <div key={m.id} data-msg={m.id} className={cls('rounded-lg px-2 transition-colors', grouped ? 'pt-0.5' : 'pt-2.5', target === m.id && 'bg-[var(--focus-bg)]')}>
              {!grouped && (
                <div className="mb-0.5 flex items-baseline gap-2 text-[12px]">
                  <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: colorOf(m, i) }} />
                  <span className="font-semibold" style={{ color: colorOf(m, i) }}>
                    {m.by}
                    {mine ? ' (you)' : ''}
                  </span>
                  <span className="t3">{new Date(m.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words pl-4 text-[13.5px] leading-relaxed">{m.text}</div>
              {m.cell && (
                <button
                  className="t2 ml-4 mt-1 flex max-w-full items-center gap-1 truncate rounded-md border bd px-1.5 py-0.5 text-[11.5px] hover:bg-[var(--hover-bg)]"
                  onClick={() => editor.reveal(m.cell!)}
                  title="Jump to the cell"
                  disabled={!label}
                  data-testid="msg-cell"
                >
                  <Icon.pin /> {label ?? 'cell was deleted'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </DockFrame>
  );
}
