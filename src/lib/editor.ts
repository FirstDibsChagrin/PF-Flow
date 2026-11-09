// Per-open-flow editing controller: focus, Flower-style navigation, cell actions, undo.
import * as Y from 'yjs';
import { Store } from './store';
import { LOCAL, PROVISIONAL, type DocSync } from './sync';
import {
  childrenOf,
  deleteCell,
  getNode,
  insertCell,
  levelOf,
  liveChildren,
  meta,
  ROOT,
  rootOf,
  setCellProp,
  sheetColumns,
  sheetOrder,
  sheetsMap,
  txn,
  type Column,
  type Mark,
  type Mode,
  type SheetKind,
} from './model';


export interface Focus {
  sheet: string | null;
  node: string | null;
}

export type DockPanel = 'round' | 'tracker' | 'chat' | 'ext' | 'history';

export class FlowEditor {
  doc: Y.Doc;
  /** which right-side dock panel is open (one at a time) */
  dock = new Store<DockPanel | null>(null);
  /** a cell briefly highlighted after "jump to" from a panel */
  flash = new Store<string | null>(null);
  /** read-only editors (version preview) */
  readOnly = false;
  /** the last cell I had selected (for "Attach to cell" in chat) */
  lastCell = new Store<string | null>(null);
  /** chat: cell id -> attached message ids (set up by the flow page) */
  chatCells = new Store<Record<string, string[]>>({});
  /** chat: message to scroll to / highlight when the chat panel opens */
  chatTarget = new Store<string | null>(null);
  undo: Y.UndoManager;
  focus = new Store<Focus>({ sheet: null, node: null });
  activeSheet = new Store<string | null>(null);
  /** where the caret should go when a cell receives focus */
  caretHint: 'end' | 'start' | 'keep' = 'end';

  constructor(public sync: DocSync, public room: string, public id: string) {
    this.doc = sync.doc;
    this.undo = new Y.UndoManager(
      [this.doc.getMap('nodes'), this.doc.getMap('sheets'), this.doc.getArray('sheetOrder'), this.doc.getMap('meta')],
      { trackedOrigins: new Set([LOCAL]), captureTimeout: 600 },
    );
    this.undo.on('stack-item-added', (e: any) => {
      e.stackItem.meta.set('focus', this.focus.get());
    });
    this.undo.on('stack-item-popped', (e: any) => {
      const f: Focus | undefined = e.stackItem.meta.get('focus');
      queueMicrotask(() => {
        if (f?.node && getNode(this.doc, f.node)) this.setFocus(f.node);
        else if (this.focus.get().node && !getNode(this.doc, this.focus.get().node)) this.blur();
      });
    });
  }

  destroy() {
    this.undo.destroy();
  }

  toggleDock(p: DockPanel) {
    this.dock.set(this.dock.get() === p ? null : p);
  }

  /** Show a cell without stealing keyboard focus from a panel: switch tab, scroll, flash. */
  reveal(id: string) {
    const n = getNode(this.doc, id);
    if (!n) return false;
    const sheet = n.get('sheet');
    if (sheet !== this.activeSheet.get()) this.activeSheet.set(sheet);
    this.flash.set(null);
    setTimeout(() => {
      this.flash.set(id);
      document.querySelector(`[data-cell="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }, 30);
    setTimeout(() => {
      if (this.flash.get() === id) this.flash.set(null);
    }, 1800);
    return true;
  }

  get mode(): Mode {
    return meta(this.doc).get('mode') || 'aff';
  }
  sheetKind(sheetId: string): SheetKind {
    return sheetsMap(this.doc).get(sheetId)?.get('kind') || 'extra';
  }
  columns(sheetId: string): Column[] {
    return sheetColumns(this.sheetKind(sheetId), this.mode);
  }
  hidden(sheetId: string): Set<string> {
    return new Set(sheetsMap(this.doc).get(sheetId)?.get('hidden') || []);
  }
  sheets(): string[] {
    const m = sheetsMap(this.doc);
    return sheetOrder(this.doc)
      .toArray()
      .filter((s, i, a) => m.has(s) && a.indexOf(s) === i);
  }

  // ---------- focus ----------
  setFocus(node: string | null, caret: 'end' | 'start' | 'keep' = 'end') {
    this.caretHint = caret;
    if (node !== this.focus.get().node) {
      this.undo.stopCapturing();
      this.cleanupProvisional(node);
    }
    if (!node) return this.blur();
    const sheet = getNode(this.doc, node)?.get('sheet') ?? null;
    if (sheet && sheet !== this.activeSheet.get()) this.activeSheet.set(sheet);
    this.focus.set({ sheet, node });
    this.lastCell.set(node);
  }
  blur() {
    this.cleanupProvisional(null);
    const f = this.focus.get();
    if (f.node) this.focus.set({ sheet: f.sheet, node: null });
  }

  // ---------- structure helpers ----------
  parentOf(id: string): string {
    return getNode(this.doc, id)?.get('parent') ?? '';
  }
  siblings(id: string): string[] {
    return liveChildren(this.doc, this.parentOf(id));
  }
  ncols(id: string) {
    const sheet = getNode(this.doc, id)?.get('sheet');
    return sheet ? this.columns(sheet).length : 0;
  }
  isHiddenLevel(sheet: string, level: number) {
    const cols = this.columns(sheet);
    return level < cols.length && this.hidden(sheet).has(cols[level].key);
  }
  focusable(id: string | null | undefined): boolean {
    if (!id) return false;
    const n = getNode(this.doc, id);
    if (!n || n.get('empty')) return false;
    const lvl = levelOf(this.doc, id);
    const sheet = n.get('sheet');
    if (lvl >= this.columns(sheet).length) return false;
    return !this.isHiddenLevel(sheet, lvl);
  }

  /** Flower's getAdjacentBox: next/prev cell in the same column, crossing parent boundaries. */
  adjacent(id: string, dir: 'up' | 'down'): string | null {
    const parent = this.parentOf(id);
    const sibs = liveChildren(this.doc, parent);
    const i = sibs.indexOf(id);
    const ni = dir === 'up' ? i - 1 : i + 1;
    if (ni >= 0 && ni < sibs.length) return sibs[ni];
    if (parent.startsWith(ROOT)) return null;
    let adjParent = this.adjacent(parent, dir);
    while (adjParent && liveChildren(this.doc, adjParent).length === 0) adjParent = this.adjacent(adjParent, dir);
    if (!adjParent) return null;
    const kids = liveChildren(this.doc, adjParent);
    return dir === 'up' ? kids[kids.length - 1] : kids[0];
  }

  focusAdjacent(id: string, dir: 'up' | 'down'): boolean {
    let cur: string | null = id;
    while (true) {
      cur = this.adjacent(cur, dir);
      if (!cur) return false;
      if (this.focusable(cur)) {
        this.setFocus(cur);
        return true;
      }
    }
  }
  focusParent(id: string): boolean {
    let p = this.parentOf(id);
    while (p && !p.startsWith(ROOT)) {
      if (this.focusable(p)) {
        this.setFocus(p);
        return true;
      }
      p = this.parentOf(p);
    }
    return false;
  }
  firstFocusableDescendant(id: string): string | null {
    for (const c of liveChildren(this.doc, id)) {
      if (this.focusable(c)) return c;
      const n = getNode(this.doc, c);
      if (n && levelOf(this.doc, c) < this.ncols(c)) {
        const d = this.firstFocusableDescendant(c);
        if (d) return d;
      }
    }
    return null;
  }
  focusChild(id: string): boolean {
    const d = this.firstFocusableDescendant(id);
    if (d) this.setFocus(d);
    return !!d;
  }
  focusSibling(id: string, dir: 1 | -1, fallbackAdjacent = true): boolean {
    const sibs = this.siblings(id);
    for (let i = sibs.indexOf(id) + dir; i >= 0 && i < sibs.length; i += dir) {
      if (this.focusable(sibs[i])) {
        this.setFocus(sibs[i]);
        return true;
      }
    }
    return fallbackAdjacent ? this.focusAdjacent(id, dir === 1 ? 'down' : 'up') : false;
  }

  // ---------- creation ----------
  /** Insert a sibling next to id (offset 0 = above, 1 = below). */
  addSibling(id: string, offset: 0 | 1): string | null {
    this.undo.stopCapturing();
    const parent = this.parentOf(id);
    const arr = childrenOf(this.doc, parent);
    if (!arr) return null;
    const raw = arr.toArray().indexOf(id);
    const nid = insertCell(this.doc, parent, raw + offset);
    this.setFocus(nid);
    return nid;
  }

  /** Add a response (child) in the next visible column; creates placeholders through hidden columns. */
  addChild(id: string, atStart = false): string | null {
    const n = getNode(this.doc, id);
    if (!n) return null;
    const sheet = n.get('sheet');
    const cols = this.columns(sheet).length;
    let level = levelOf(this.doc, id) + 1;
    if (level >= cols) return null;
    let nid: string | null = null;
    txn(this.doc, () => {
      let parent = id;
      while (level < cols && this.isHiddenLevel(sheet, level)) {
        parent = insertCell(this.doc, parent, atStart ? 0 : 1e9, { empty: true });
        level++;
      }
      if (level >= cols) return;
      let index = atStart ? 0 : 1e9;
      // keep an extension marker (if any) first
      const kids = liveChildren(this.doc, parent);
      if (atStart && kids[0] && getNode(this.doc, kids[0])?.get('ext')) index = 1;
      nid = insertCell(this.doc, parent, index);
    });
    if (nid) this.setFocus(nid);
    return nid;
  }

  // ---------- responding in the same row ----------
  // provisional cells: 'new' = created by a click (deleted if left blank),
  // 'fill' = a placeholder you clicked into (turned back into a placeholder if left blank)
  private provisional = new Map<string, 'new' | 'fill'>();

  /**
   * Start typing directly to the right of an argument (same row, next column).
   * The new cell is provisional: if you leave it without typing anything it disappears again.
   */
  respond(id: string): string | null {
    let nid: string | null = null;
    this.doc.transact(() => {
      nid = this.addChild(id);
    }, PROVISIONAL);
    if (nid) this.provisional.set(nid, 'new');
    return nid;
  }

  /** Start a response in any column `col` to the right of `id`, in the same row (placeholders fill the gap). */
  respondAt(id: string, col: number): string | null {
    const n = getNode(this.doc, id);
    if (!n) return null;
    const lvl = levelOf(this.doc, id);
    if (col <= lvl || col >= this.ncols(id)) return null;
    let nid = '';
    this.doc.transact(() => {
      let parent = id;
      for (let l = lvl + 1; l < col; l++) parent = insertCell(this.doc, parent, 1e9, { empty: true });
      nid = insertCell(this.doc, parent, 1e9);
    }, PROVISIONAL);
    this.provisional.set(nid, 'new');
    this.setFocus(nid);
    return nid;
  }

  /** Type into a blank placeholder cell (a column that was skipped in this row). */
  fillPlaceholder(id: string) {
    const n = getNode(this.doc, id);
    if (!n?.get('empty')) return;
    this.doc.transact(() => n.delete('empty'), PROVISIONAL);
    this.provisional.set(id, 'fill');
    this.setFocus(id);
  }

  /** New argument starting in any column, as a new row at the bottom of the sheet. */
  startInColumn(sheet: string, col: number): string {
    let nid = '';
    this.doc.transact(() => {
      let parent = rootOf(sheet);
      for (let l = 0; l < col; l++) parent = insertCell(this.doc, parent, 1e9, { empty: true });
      nid = insertCell(this.doc, parent, 1e9);
    }, PROVISIONAL);
    this.provisional.set(nid, 'new');
    this.setFocus(nid);
    return nid;
  }

  private cleanupProvisional(keep: string | null) {
    if (!this.provisional.size) return;
    for (const [id, kind] of [...this.provisional]) {
      if (id === keep) continue;
      this.provisional.delete(id);
      const n = getNode(this.doc, id);
      if (!n) continue;
      const textless = (n.get('text') as Y.Text).length === 0 && !n.get('mark');
      if (kind === 'fill') {
        if (textless) this.doc.transact(() => n.set('empty', true), PROVISIONAL);
        continue;
      }
      if (!textless || liveChildren(this.doc, id).length > 0) continue;
      this.doc.transact(() => {
        let parent = this.parentOf(id);
        deleteCell(this.doc, id);
        while (parent && !parent.startsWith(ROOT) && getNode(this.doc, parent)?.get('empty') && liveChildren(this.doc, parent).length === 0) {
          const pp = this.parentOf(parent);
          deleteCell(this.doc, parent);
          parent = pp;
        }
      }, PROVISIONAL);
    }
  }

  /** New argument starting in a given column (column header "+"). */
  addInColumn(sheet: string, col: number): string {
    let nid = '';
    txn(this.doc, () => {
      let parent = rootOf(sheet);
      for (let l = 0; l < col; l++) parent = insertCell(this.doc, parent, 1e9, { empty: true });
      nid = insertCell(this.doc, parent, 1e9);
    });
    this.setFocus(nid);
    return nid;
  }

  addRow(sheet: string): string {
    const nid = insertCell(this.doc, rootOf(sheet), 1e9);
    this.setFocus(nid);
    return nid;
  }

  /** Alt+Shift+Enter: respond to the next argument (child of parent's next sibling). */
  addToParentsNext(id: string): string | null {
    const parent = this.parentOf(id);
    if (!parent || parent.startsWith(ROOT)) return null;
    const next = this.adjacent(parent, 'down');
    if (!next) return null;
    const nid = insertCell(this.doc, next, 0);
    this.setFocus(nid);
    return nid;
  }

  /** Flower "extend": an arrow cell carries the argument into the next column, then a cell after it. */
  extend(id: string): string | null {
    const n = getNode(this.doc, id);
    if (!n || n.get('ext')) return null;
    const lvl = levelOf(this.doc, id);
    const cols = this.ncols(id);
    if (lvl + 1 >= cols) return null;
    const kids = liveChildren(this.doc, id);
    if (kids[0] && getNode(this.doc, kids[0])?.get('ext')) return null;
    let target: string | null = null;
    txn(this.doc, () => {
      const ext = insertCell(this.doc, id, 0, { ext: true });
      if (lvl + 2 < cols) target = insertCell(this.doc, ext, 0);
    });
    if (target) this.setFocus(target);
    return target;
  }

  /** Delete a cell and move focus to a sensible neighbour. */
  remove(id: string) {
    this.undo.stopCapturing();
    const sibs = this.siblings(id);
    const i = sibs.indexOf(id);
    const parent = this.parentOf(id);
    let next: string | null = null;
    for (let j = i - 1; j >= 0 && !next; j--) if (this.focusable(sibs[j])) next = sibs[j];
    if (!next && parent && !parent.startsWith(ROOT) && this.focusable(parent)) next = parent;
    if (!next) for (let j = i + 1; j < sibs.length && !next; j++) if (this.focusable(sibs[j])) next = sibs[j];
    if (!next) {
      let cur: string | null = id;
      while ((cur = this.adjacent(cur, 'up')) && !this.focusable(cur));
      next = cur;
    }
    txn(this.doc, () => {
      deleteCell(this.doc, id);
      // clean up placeholder chains left without content
      let p = parent;
      while (p && !p.startsWith(ROOT) && getNode(this.doc, p)?.get('empty') && liveChildren(this.doc, p).length === 0) {
        const pp = this.parentOf(p);
        deleteCell(this.doc, p);
        p = pp;
      }
    });
    if (next) this.setFocus(next);
    else {
      this.blur();
      // never leave a sheet with nothing to click into
      const sheet = this.activeSheet.get();
      if (sheet && liveChildren(this.doc, rootOf(sheet)).length === 0) this.addRow(sheet);
    }
  }

  setMark(id: string, mark: Mark | null) {
    const n = getNode(this.doc, id);
    if (!n) return;
    setCellProp(this.doc, id, 'mark', n.get('mark') === mark ? null : mark);
  }
  toggle(id: string, prop: 'bold' | 'crossed') {
    const n = getNode(this.doc, id);
    if (n) setCellProp(this.doc, id, prop, !n.get(prop));
  }
}
