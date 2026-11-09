// Drop/extend tracker: pure analysis of a sheet's cell tree (no Yjs here, so it's unit-testable).
//
// Rules (also in the README):
// 1. An ARGUMENT is the first non-empty cell along a row: a top-level cell with text, or, for rows
//    that start in a later column (blank placeholders before it), the first descendant with text.
//    Its column decides which side made it.
// 2. The ARGUING SIDE's later cells are every cell of that side anywhere in the argument's row
//    (including frontlines written under a response).
// 3. A RESPONSE is the first cell of the other side along a branch under the argument. The other
//    side's later cells under it are that response's own extensions.
// 4. A side "extended" an item in a speech (Rebuttal, Summary, Final Focus) if some cell of that
//    speech in the item's scope is marked Extended, or is an Extend (→) cell. A cell that's there
//    but not marked counts as "present" (not extended). Speeches before the item, or not a column
//    on this tab, are "n/a".
// 5. A GAP is a speech that isn't extended after an earlier speech that was.
// 6. Anything marked Dropped is left out: dropped cells never count, and dropped arguments or
//    responses aren't listed.
import type { Mark, Side, SpeechKey } from './model';

export interface TNode {
  id: string;
  text: string;
  mark?: Mark | null;
  ext?: boolean; // Flower-style "extend" arrow cell
  empty?: boolean; // blank placeholder
  children: TNode[];
}
export interface TColumn {
  key: SpeechKey;
  side: Side;
}
export interface TSheet {
  id: string;
  name: string;
  columns: TColumn[];
  roots: TNode[];
}

export type SpeechType = 'R' | 'S' | 'F';
export const SPEECH_TYPES: SpeechType[] = ['R', 'S', 'F'];
export type ChipState = 'extended' | 'present' | 'missing' | 'na';
export interface Chip {
  speech: SpeechType;
  state: ChipState;
  gap: boolean;
  /** a cell to jump to for this speech (the extended one if any) */
  nodeId?: string;
}
export interface TItem {
  id: string;
  text: string;
  side: Side;
  column: SpeechKey;
  chips: Chip[];
  extendedOnce: boolean;
  hasGap: boolean;
}
export interface TArgument extends TItem {
  responses: TItem[];
}
export interface TSheetResult {
  sheetId: string;
  name: string;
  args: TArgument[];
}

const ORDER: SpeechKey[] = ['C1', 'C2', 'R1', 'R2', 'S1', 'S2', 'F1', 'F2'];
const hasText = (n: TNode) => !n.empty && !n.ext && n.text.trim().length > 0;
const isDropped = (n: TNode) => n.mark === 'dropped';
const counts = (n: TNode) => !isDropped(n) && (n.ext || n.mark === 'extended');

interface Placed {
  node: TNode;
  level: number;
}

/** All nodes under `n` (not including n), with their column level. Stops past the last column. */
function descendants(n: TNode, level: number, ncols: number): Placed[] {
  const out: Placed[] = [];
  const walk = (x: TNode, l: number) => {
    for (const c of x.children) {
      if (l + 1 >= ncols) continue;
      out.push({ node: c, level: l + 1 });
      walk(c, l + 1);
    }
  };
  walk(n, level);
  return out;
}

function chipsFor(side: Side, fromLevel: number, cells: Placed[], columns: TColumn[]): Chip[] {
  const chips: Chip[] = SPEECH_TYPES.map((t) => {
    const lvl = columns.findIndex((c, i) => i > fromLevel && c.side === side && c.key[0] === t);
    if (lvl < 0) return { speech: t, state: 'na', gap: false };
    const here = cells.filter((p) => p.level === lvl && !isDropped(p.node) && (hasText(p.node) || p.node.ext));
    const ext = here.find((p) => counts(p.node));
    if (ext) return { speech: t, state: 'extended', gap: false, nodeId: ext.node.id };
    if (here.length) return { speech: t, state: 'present', gap: false, nodeId: here[0].node.id };
    return { speech: t, state: 'missing', gap: false };
  });
  let seen = false;
  for (const c of chips) {
    if (c.state === 'na') continue;
    if (c.state === 'extended') seen = true;
    else if (seen) c.gap = true;
  }
  return chips;
}

function item(node: TNode, level: number, columns: TColumn[], scope: Placed[]): TItem {
  const col = columns[level];
  const own = scope.filter((p) => columns[p.level].side === col.side);
  const chips = chipsFor(col.side, level, own, columns);
  return {
    id: node.id,
    text: node.text.trim(),
    side: col.side,
    column: col.key,
    chips,
    extendedOnce: chips.some((c) => c.state === 'extended'),
    hasGap: chips.some((c) => c.gap),
  };
}

/** Top-most cells of side `side` with text under `n` (not crossing another cell of that side). */
function topCellsOfSide(n: TNode, level: number, side: Side, columns: TColumn[]): Placed[] {
  const out: Placed[] = [];
  const walk = (x: TNode, l: number) => {
    for (const c of x.children) {
      const cl = l + 1;
      if (cl >= columns.length) continue;
      if (columns[cl].side === side && hasText(c)) out.push({ node: c, level: cl });
      else walk(c, cl);
    }
  };
  walk(n, level);
  return out;
}

/** First cells with text along each branch (the row's arguments). */
function argumentsOf(n: TNode, level: number, ncols: number): Placed[] {
  if (level >= ncols) return [];
  if (hasText(n)) return [{ node: n, level }];
  return n.children.flatMap((c) => argumentsOf(c, level + 1, ncols));
}

export function analyzeSheet(sheet: TSheet): TSheetResult {
  const { columns } = sheet;
  const args: TArgument[] = [];
  for (const root of sheet.roots) {
    for (const a of argumentsOf(root, 0, columns.length)) {
      if (isDropped(a.node)) continue;
      const scope = descendants(a.node, a.level, columns.length);
      const arg = item(a.node, a.level, columns, scope);
      const other: Side = arg.side === 'aff' ? 'con' : 'aff';
      const responses = topCellsOfSide(a.node, a.level, other, columns)
        .filter((r) => !isDropped(r.node))
        .map((r) => item(r.node, r.level, columns, descendants(r.node, r.level, columns.length)));
      args.push({ ...arg, responses });
    }
  }
  return { sheetId: sheet.id, name: sheet.name, args };
}

/** Default view: arguments extended at least once (by either side's chain) or flagged; toggle shows all. */
export function visibleArgs(res: TSheetResult, showAll: boolean): TArgument[] {
  return res.args
    .map((a) => ({ ...a, responses: showAll ? a.responses : a.responses.filter((r) => r.extendedOnce || r.hasGap) }))
    .filter((a) => showAll || a.extendedOnce || a.hasGap || a.responses.length > 0);
}

export const speechOrder = (k: SpeechKey) => ORDER.indexOf(k);
