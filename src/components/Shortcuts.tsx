import { Store, useStore } from '../lib/store';
import { isMac } from '../lib/util';
import { Modal } from './ui';

const open = new Store(false);
export const openShortcuts = () => open.set(true);

const M = isMac ? '⌘' : 'Ctrl';
const A = isMac ? '⌥' : 'Alt';
export const SHORTCUT_GROUPS: { name: string; context: string; items: [string[], string][] }[] = [
  {
    name: 'Navigate',
    context: 'While a cell is focused',
    items: [
      [['↑'], 'Cell above (same column)'],
      [['↓'], 'Cell below (same column)'],
      [['←'], 'Parent — the argument this responds to'],
      [['→'], 'First response — or start one in the same row'],
      [['Tab'], 'Next sibling cell'],
      [['Shift', 'Tab'], 'Previous sibling cell'],
      [['Esc'], 'Leave the cell'],
      [['↑ ↓ ← → / ↵'], 'Jump back into the flow (when no cell is focused)'],
    ],
  },
  {
    name: 'Create',
    context: 'While a cell is focused',
    items: [
      [['↵'], 'Next sibling, or a new cell below if none'],
      [['Shift', '↵'], 'Add a response (next column)'],
      [[M, '↵'], 'Insert a new cell directly below'],
      [[M, 'Shift', '↵'], 'Insert a new cell directly above'],
      [[A, '↵'], 'Previous sibling, or a new cell above if none'],
      [[A, 'Shift', '↵'], 'Respond to the next argument'],
      [[M, 'E'], 'Extend: carry the argument into the next column'],
      [['Click any empty spot'], 'Write there — rows stay aligned to their argument'],
      [['Click a line'], 'Hover between cells and click to insert'],
      [['Bottom row'], 'Start a new argument in any column'],
    ],
  },
  {
    name: 'Edit & mark',
    context: 'While a cell is focused',
    items: [
      [[A, '1'], 'Mark dropped (again to clear)'],
      [[A, '2'], 'Mark extended'],
      [[A, '3'], 'Mark turned'],
      [[A, '0'], 'Clear mark'],
      [[A, '4'], 'Call evidence on / off (works with any mark)'],
      [[A, 'Shift', '4'], 'Evidence status: To call → Called → Checked'],
      [['Right-click'], 'Cell menu (marks, insert, delete)'],
      [[M, 'B'], 'Bold'],
      [[M, 'Shift', 'X'], 'Cross out'],
      [['Backspace'], 'Delete cell (when empty, no responses)'],
      [[M, 'Backspace'], 'Delete cell and its responses'],
      [[M, 'Z'], 'Undo (only your own edits)'],
      [[M, 'Shift', 'Z'], 'Redo'],
    ],
  },
  {
    name: 'Tabs & app',
    context: 'Anywhere in a flow',
    items: [
      [[M, A, '↑ / ↓'], 'Previous / next tab'],
      [['Double-click tab'], 'Rename tab'],
      [[M, '/'], 'This shortcuts list'],
    ],
  },
  {
    name: 'Timers',
    context: 'Anywhere in a flow (synced with partner)',
    items: [
      [[A, 'S'], 'Start / pause speech timer'],
      [[A, 'N'], 'Next speech'],
      [[A, 'P'], 'Previous speech'],
      [[A, 'R'], 'Reset speech timer'],
      [[A, 'A'], 'Start / pause Aff prep'],
      [[A, 'C'], 'Start / pause Con prep'],
    ],
  },
  {
    name: 'Side panels',
    context: 'Anywhere in a flow (one panel open at a time)',
    items: [
      [[A, 'I'], 'Round info'],
      [[A, 'T'], 'Drop/extend tracker'],
      [[A, 'V'], 'Evidence calls'],
      [[A, 'E'], 'Extensions (also in the template editor)'],
      [[A, 'M'], 'Partner chat'],
      [[A, 'H'], 'Version history'],
      [['Esc'], 'Close the panel (or leave a version preview)'],
    ],
  },
  {
    name: 'Extensions panel',
    context: 'When the panel is open and you are not typing',
    items: [
      [['↑ / ↓'], 'Select previous / next extension (also K / J)'],
      [['↵'], 'Open / close the selected extension (also Space)'],
      [['S'], 'Show the Summary version'],
      [['F'], 'Show the Final Focus version'],
      [['E'], 'Edit the open extension'],
      [['Esc'], 'Stop editing, then back to the list'],
    ],
  },
  {
    name: 'Chat',
    context: 'In the chat box',
    items: [
      [['↵'], 'Send'],
      [['Shift', '↵'], 'New line'],
    ],
  },
];

export function ShortcutsHost() {
  const isOpen = useStore(open);
  if (!isOpen) return null;
  return (
    <Modal onClose={() => open.set(false)} title="Keyboard shortcuts" width={760}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 px-6 py-5">
        {SHORTCUT_GROUPS.map((g) => (
          <div key={g.name}>
            <div className="mb-0.5 text-[13px] font-semibold">{g.name}</div>
            <div className="t3 mb-2.5 text-[11.5px]">{g.context}</div>
            <div className="space-y-1.5">
              {g.items.map(([keys, desc]) => (
                <div key={desc} className="flex items-center justify-between gap-4 text-[12.5px]">
                  <span className="t2">{desc}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <span key={k} className="kbd">
                        {k}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
