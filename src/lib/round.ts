// Round metadata ("Round info"), stored in the flow doc so both partners edit it live.
//
// round: Y.Map {
//   opponent, judge, tournament, round, speaks, ballotNotes, feedback: Y.Text  (character-level merge)
//   side: 'aff' | 'con' | undefined          (which side WE are on)
//   result: 'win' | 'loss' | 'pending' | undefined
// }
// Speaking order is NOT stored here: it is the flow's existing meta.mode.
import * as Y from 'yjs';
import { LOCAL, SYSTEM } from './sync';
import type { Side } from './model';

export type Result = 'win' | 'loss' | 'pending';
export const TEXT_FIELDS = ['opponent', 'judge', 'tournament', 'round', 'speaks', 'ballotNotes', 'feedback'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** The subset mirrored onto dashboard entries (cards, filters, search). */
export interface RoundSummary {
  opponent: string;
  judge: string;
  tournament: string;
  round: string;
  side: Side | '';
  result: Result | '';
}
export const EMPTY_SUMMARY: RoundSummary = { opponent: '', judge: '', tournament: '', round: '', side: '', result: '' };

export const roundMap = (d: Y.Doc) => d.getMap<any>('round');

/** Get (creating on first use) the shared Y.Text for a text field. */
export function roundText(d: Y.Doc, field: TextField): Y.Text {
  const m = roundMap(d);
  let t = m.get(field);
  if (!(t instanceof Y.Text)) {
    t = new Y.Text();
    d.transact(() => m.set(field, t), SYSTEM);
    // a concurrent first-use by the partner may have won; always return the stored one
    t = m.get(field);
  }
  return t;
}

export function readText(d: Y.Doc, field: TextField): string {
  const t = roundMap(d).get(field);
  return t instanceof Y.Text ? t.toString() : '';
}

export function setRoundValue(d: Y.Doc, key: 'side' | 'result', value: string | null) {
  d.transact(() => {
    if (value) roundMap(d).set(key, value);
    else roundMap(d).delete(key);
  }, LOCAL);
}

export function readSummary(d: Y.Doc): RoundSummary {
  const m = roundMap(d);
  return {
    opponent: readText(d, 'opponent').trim(),
    judge: readText(d, 'judge').trim(),
    tournament: readText(d, 'tournament').trim(),
    round: readText(d, 'round').trim(),
    side: (m.get('side') as Side) || '',
    result: (m.get('result') as Result) || '',
  };
}

export const RESULT_LABEL: Record<Result, string> = { win: 'Win', loss: 'Loss', pending: 'Pending' };

/** Create the shared text fields up front (after syncing) so two people typing at once never race to create them. */
export function ensureRoundFields(d: Y.Doc) {
  const m = roundMap(d);
  const missing = TEXT_FIELDS.filter((f) => !(m.get(f) instanceof Y.Text));
  if (!missing.length) return;
  d.transact(() => {
    for (const f of missing) m.set(f, new Y.Text());
  }, SYSTEM);
}
