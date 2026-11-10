// "Call evidence" marker: an independent flag on a cell (coexists with Dropped/Extended/Turned).
//
// Stored on the cell's node map, so it syncs, merges offline, is versioned and undoable like any
// other cell edit:
//   call:     'todo' | 'called' | 'checked'   (absent = not marked)
//   callNote: Y.Text                          (optional short note: card, author, what to check)
import * as Y from 'yjs';
import { getNode } from './model';
import { LOCAL } from './sync';

export type CallStatus = 'todo' | 'called' | 'checked';
export const CALL_STATUSES: CallStatus[] = ['todo', 'called', 'checked'];
export const CALL_LABEL: Record<CallStatus, string> = { todo: 'To call', called: 'Called', checked: 'Checked' };

export const callOf = (d: Y.Doc, id: string): CallStatus | null => (getNode(d, id)?.get('call') as CallStatus) ?? null;
export const callNote = (d: Y.Doc, id: string): Y.Text | undefined => {
  const t = getNode(d, id)?.get('callNote');
  return t instanceof Y.Text ? t : undefined;
};

/** Mark (status) or clear (null) a call. Marking also creates the note field in the same edit. */
export function setCall(d: Y.Doc, id: string, status: CallStatus | null) {
  const n = getNode(d, id);
  if (!n) return;
  d.transact(() => {
    if (!status) {
      n.delete('call');
      n.delete('callNote');
      return;
    }
    n.set('call', status);
    if (!(n.get('callNote') instanceof Y.Text)) n.set('callNote', new Y.Text());
  }, LOCAL);
}

export const toggleCall = (d: Y.Doc, id: string) => setCall(d, id, callOf(d, id) ? null : 'todo');

/** To call -> Called -> Checked -> To call (marks the cell first if needed). */
export function cycleCall(d: Y.Doc, id: string) {
  const cur = callOf(d, id);
  setCall(d, id, cur ? CALL_STATUSES[(CALL_STATUSES.indexOf(cur) + 1) % CALL_STATUSES.length] : 'todo');
}
