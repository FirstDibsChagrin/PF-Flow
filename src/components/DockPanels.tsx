import type { DockPanel, FlowEditor } from '../lib/editor';
import { DockFrame } from './Dock';

export function DockPanels({ editor, kind, panel }: { editor: FlowEditor; kind: 'flow' | 'template'; panel: DockPanel }) {
  void kind;
  return (
    <DockFrame title={panel} onClose={() => editor.dock.set(null)}>
      <div className="t3 p-5 text-sm">Coming up.</div>
    </DockFrame>
  );
}
