import { describe, expect, it } from 'vitest';
import { analyzeSheet, visibleArgs, type TColumn, type TNode, type TSheet } from './tracker';

// Column layouts exactly as the app builds them (Aff speaks first):
//   Aff tab (first team):  AC  NR  AS  NS  AFF NFF
//   Con tab (second team): NC  AR  NR  AS  NS  AFF NFF
//   extra tab:             AC  NC  AR  NR  AS  NS  AFF NFF
const A = 'aff' as const;
const N = 'con' as const;
const AFF_TAB: TColumn[] = [
  { key: 'C1', side: A },
  { key: 'R2', side: N },
  { key: 'S1', side: A },
  { key: 'S2', side: N },
  { key: 'F1', side: A },
  { key: 'F2', side: N },
];
const CON_TAB: TColumn[] = [
  { key: 'C2', side: N },
  { key: 'R1', side: A },
  { key: 'R2', side: N },
  { key: 'S1', side: A },
  { key: 'S2', side: N },
  { key: 'F1', side: A },
  { key: 'F2', side: N },
];
const EXTRA_TAB: TColumn[] = [
  { key: 'C1', side: A },
  { key: 'C2', side: N },
  { key: 'R1', side: A },
  { key: 'R2', side: N },
  { key: 'S1', side: A },
  { key: 'S2', side: N },
  { key: 'F1', side: A },
  { key: 'F2', side: N },
];

let seq = 0;
type Opts = Partial<Omit<TNode, 'children' | 'id' | 'text'>> & { id?: string };
const n = (text: string, children: TNode[] = [], o: Opts = {}): TNode => ({ id: o.id ?? `n${++seq}`, text, children, mark: o.mark, ext: o.ext, empty: o.empty });
const ext = (text: string, kids: TNode[] = [], id?: string) => n(text, kids, { mark: 'extended', id });
const blank = (kids: TNode[]) => n('', kids, { empty: true });
const sheet = (columns: TColumn[], roots: TNode[]): TSheet => ({ id: 's', name: 'Tab', columns, roots });
const states = (chips: { speech: string; state: string; gap: boolean }[]) => chips.map((c) => `${c.speech}:${c.state}${c.gap ? '!' : ''}`).join(' ');

describe('arguments and their side', () => {
  it('a top-level cell is an argument made by its column side', () => {
    const r = analyzeSheet(sheet(AFF_TAB, [n('C1 econ')]));
    expect(r.args).toHaveLength(1);
    expect(r.args[0]).toMatchObject({ text: 'C1 econ', side: 'aff', column: 'C1' });
  });

  it('a row starting in a later column (placeholders before it) is an argument of that column', () => {
    const r = analyzeSheet(sheet(AFF_TAB, [blank([n('NR off: tradeoff DA')])]));
    expect(r.args[0]).toMatchObject({ text: 'NR off: tradeoff DA', side: 'con', column: 'R2' });
  });

  it('blank (untyped) cells are skipped when finding the argument', () => {
    const r = analyzeSheet(sheet(AFF_TAB, [n('   ', [n('NR turn')])]));
    expect(r.args.map((a) => a.text)).toEqual(['NR turn']);
  });
});

describe('extension chips for the arguing side', () => {
  it('first team on its own tab has no Rebuttal column: R is n/a', () => {
    const arg = n('C1', [n('NR answer', [ext('AS extend', [n('NS', [ext('AFF extend')])])])]);
    const a = analyzeSheet(sheet(AFF_TAB, [arg])).args[0];
    expect(states(a.chips)).toBe('R:na S:extended F:extended');
    expect(a.extendedOnce).toBe(true);
    expect(a.hasGap).toBe(false);
  });

  it('flags a gap when extended in Summary but not in Final Focus', () => {
    const arg = n('C1', [n('NR', [ext('AS extend')])]);
    const a = analyzeSheet(sheet(AFF_TAB, [arg])).args[0];
    expect(states(a.chips)).toBe('R:na S:extended F:missing!');
    expect(a.hasGap).toBe(true);
  });

  it('second team: frontline in Rebuttal extended, Summary present but unmarked -> gap at S', () => {
    const arg = n('NC1', [n('AR answer', [ext('NR frontline', [n('AS', [n('NS mentioned, not marked')])])])]);
    const a = analyzeSheet(sheet(CON_TAB, [arg])).args[0];
    expect(a.side).toBe('con');
    expect(states(a.chips)).toBe('R:extended S:present! F:missing!');
  });

  it('frontlines written under a response count toward the argument', () => {
    // AC -> NR response -> AS frontline (extended) under the response
    const arg = n('C1', [n('NR', [ext('AS frontline')])]);
    expect(analyzeSheet(sheet(AFF_TAB, [arg])).args[0].chips[1].state).toBe('extended');
  });

  it('an Extend (→) cell counts as extended', () => {
    const arg = n('C1', [n('', [], { ext: true }), n('NR', [n('', [], { ext: true })])]);
    // the → cell under NR sits in the AS column (level 2)
    const a = analyzeSheet(sheet(AFF_TAB, [arg])).args[0];
    expect(a.chips.find((c) => c.speech === 'S')!.state).toBe('extended');
  });

  it('never-extended argument is not "extendedOnce" and has no gap', () => {
    const a = analyzeSheet(sheet(AFF_TAB, [n('C2 health', [n('NR')])])).args[0];
    expect(a.extendedOnce).toBe(false);
    expect(a.hasGap).toBe(false);
    expect(states(a.chips)).toBe('R:na S:missing F:missing');
  });

  it('jump targets point at the extended cell', () => {
    const arg = n('C1', [n('NR', [ext('AS', [], 'target')])]);
    expect(analyzeSheet(sheet(AFF_TAB, [arg])).args[0].chips[1].nodeId).toBe('target');
  });
});

describe('responses', () => {
  it('lists the other side’s first cells as responses, each with its own chips', () => {
    const arg = n('C1', [ext('NR1 delink', [n('AS', [ext('NS extends delink')])]), n('NR2 turn')]);
    const a = analyzeSheet(sheet(AFF_TAB, [arg])).args[0];
    expect(a.responses.map((r) => r.text)).toEqual(['NR1 delink', 'NR2 turn']);
    // Con on the Aff tab: their Rebuttal (R2) IS the response column, so R is n/a for chips after it
    expect(states(a.responses[0].chips)).toBe('R:na S:extended F:missing!');
    expect(a.responses[1].extendedOnce).toBe(false);
  });

  it('a response is extended through Summary only while the argument goes through FF', () => {
    const arg = n('C1', [n('NR delink', [ext('AS frontline', [ext('NS delink again', [ext('AFF extend')])])])]);
    const a = analyzeSheet(sheet(AFF_TAB, [arg])).args[0];
    expect(states(a.chips)).toBe('R:na S:extended F:extended');
    expect(states(a.responses[0].chips)).toBe('R:na S:extended F:missing!');
  });

  it('responses on an extra tab use all eight speech columns', () => {
    const arg = n('AC weigh', [n('NC', [ext('AR', [ext('NR answer', [n('AS', [ext('NS')])])])])]);
    const a = analyzeSheet(sheet(EXTRA_TAB, [arg])).args[0];
    // AR extended; the AS cell exists but isn't marked -> present, and a gap
    expect(states(a.chips)).toBe('R:extended S:present! F:missing!');
    expect(a.responses.map((r) => r.text)).toEqual(['NC']);
    expect(states(a.responses[0].chips)).toBe('R:extended S:extended F:missing!');
  });
});

describe('dropped', () => {
  it('a dropped argument is left out', () => {
    const r = analyzeSheet(sheet(AFF_TAB, [n('C1', [], { mark: 'dropped' }), n('C2')]));
    expect(r.args.map((a) => a.text)).toEqual(['C2']);
  });
  it('a dropped response is left out', () => {
    const arg = n('C1', [n('NR dropped', [], { mark: 'dropped' }), n('NR kept')]);
    expect(analyzeSheet(sheet(AFF_TAB, [arg])).args[0].responses.map((r) => r.text)).toEqual(['NR kept']);
  });
  it('a dropped cell never counts as an extension', () => {
    const arg = n('C1', [n('NR', [n('AS', [], { mark: 'dropped' })])]);
    expect(analyzeSheet(sheet(AFF_TAB, [arg])).args[0].chips[1].state).toBe('missing');
  });
});

describe('default visibility', () => {
  const res = analyzeSheet(
    sheet(AFF_TAB, [
      n('C1 extended', [n('NR', [ext('AS')])]),
      n('C2 never', [n('NR plain')]),
      n('C3 only response extended', [n('NR', [n('AS', [ext('NS')])])]),
    ]),
  );
  it('shows arguments extended at least once (or whose responses were), hides the rest', () => {
    expect(visibleArgs(res, false).map((a) => a.text)).toEqual(['C1 extended', 'C3 only response extended']);
  });
  it('the toggle shows never-extended arguments and all their responses', () => {
    const all = visibleArgs(res, true);
    expect(all.map((a) => a.text)).toEqual(['C1 extended', 'C2 never', 'C3 only response extended']);
    expect(all[1].responses.map((r) => r.text)).toEqual(['NR plain']);
  });
});
