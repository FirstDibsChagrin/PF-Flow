import type { DockPanel, FlowEditor } from '../lib/editor';
import { DockFrame } from './Dock';
import { HistoryPanel } from './History';
import { ChatPanel } from './Chat';

export function DockPanels({ editor, kind, panel }: { editor: FlowEditor; kind: 'flow' | 'template'; panel: DockPanel }) {
  const close = () => editor.dock.set(null);
  void kind;
  if (panel === 'history') return <HistoryPanel editor={editor} onClose={close} />;
  if (panel === 'chat') return <ChatPanel editor={editor} onClose={close} />;
  return (
    <DockFrame title={panel} onClose={close}>
      <div className="t3 p-5 text-sm">Coming up.</div>
    </DockFrame>
  );
}
