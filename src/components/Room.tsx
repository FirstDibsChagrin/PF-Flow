import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  createFlow,
  createTemplate,
  deleteEntry,
  duplicateEntry,
  ensureFlowCode,
  entriesMap,
  homeIndex,
  joinFlow,
  locOf,
  readEntries,
  renameEntry,
  type DocKind,
  type Entry,
} from '../lib/room';
import type { Mode } from '../lib/model';
import { useStore } from '../lib/store';
import { transport } from '../lib/transport';
import { useY } from '../lib/yhooks';
import { cls, normalizeRoomCode, timeAgo } from '../lib/util';
import { confirmDialog, Icon, Menu, MenuItem, MenuSep, Modal, promptDialog, StatusPill, toast } from './ui';
import { openSettings } from './SettingsPanel';
import { openShortcuts } from './Shortcuts';

function HomeHeader() {
  const status = useStore(homeIndex().status);
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b bd px-6" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center gap-2.5">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        <span className="text-[15px] font-semibold tracking-tight">PF Flow</span>
      </div>
      <nav className="flex gap-1 text-[13px]">
        {[
          ['/', 'Flows'],
          ['/templates', 'Templates'],
        ].map(([p, l]) => (
          <NavLink key={p} end to={p} className={({ isActive }) => cls('btn', isActive ? 'bg-[var(--panel-2)] font-semibold' : 't2')}>
            {l}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <StatusPill status={status} local={transport.kind === 'local'} />
        <button className="btn !p-1.5" onClick={openShortcuts} title="Keyboard shortcuts">
          <Icon.keyboard />
        </button>
        <button className="btn !p-1.5" onClick={openSettings} title="Settings">
          <Icon.gear />
        </button>
      </div>
    </header>
  );
}

function JoinBox() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const r = await joinFlow(code);
    setBusy(false);
    if (r.ok) nav(`/f/${r.code}`);
    else setErr(r.error);
  };
  return (
    <form
      className="panel mb-6 flex items-center gap-3 rounded-xl px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">Join your partner's flow</div>
        <div className={cls('text-[12px]', err ? 'text-red-500' : 't3')}>{err || 'Enter the code shown at the top of their flow.'}</div>
      </div>
      <input
        className="input !w-44 text-center font-mono text-[14px] uppercase tracking-[0.2em]"
        placeholder="FLOW CODE"
        maxLength={9}
        value={code}
        onChange={(e) => {
          setCode(normalizeRoomCode(e.target.value));
          setErr('');
        }}
        data-testid="join-code"
      />
      <button className="btn btn-outline !px-4" disabled={busy || code.length < 8} data-testid="join-flow">
        {busy ? 'Joining…' : 'Join'}
      </button>
    </form>
  );
}

type Sort = 'updated' | 'name' | 'created';

export function DocList({ kind }: { kind: DocKind }) {
  const nav = useNavigate();
  const sync = homeIndex();
  const status = useStore(sync.status);
  useY(entriesMap(sync.doc), true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; e: Entry } | null>(null);
  const all = readEntries(sync.doc);
  const templates = all.filter((e) => e.kind === 'template').sort((a, b) => a.name.localeCompare(b.name));
  const flowCount = all.filter((e) => e.kind === 'flow').length;
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const xs = all.filter((e) => e.kind === kind && (!ql || e.name.toLowerCase().includes(ql)));
    xs.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
    return xs;
  }, [JSON.stringify(all), q, sort, kind]);

  const label = kind === 'flow' ? 'flow' : 'template';

  const open = async (e: Entry) => {
    if (e.kind === 'template') return nav(`/t/${e.id}`);
    const code = e.code ?? (await ensureFlowCode(e));
    nav(`/f/${code}`);
  };

  const act = {
    rename: async (e: Entry) => {
      const v = await promptDialog(`Rename ${label}`, e.name);
      if (v) await renameEntry(e, v);
    },
    duplicate: async (e: Entry) => {
      await duplicateEntry(e);
      toast('Duplicated');
    },
    remove: async (e: Entry) => {
      const body =
        e.kind === 'template'
          ? "This permanently deletes the template. This can't be undone."
          : e.joined
            ? 'This removes it from your dashboard. Your partner still has it, and you can rejoin with its code.'
            : "This permanently deletes the flow, including for anyone you shared its code with. This can't be undone.";
      const ok = await confirmDialog(`${e.joined ? 'Remove' : 'Delete'} “${e.name}”?`, body, e.joined ? 'Remove' : 'Delete', true);
      if (ok) {
        await deleteEntry(e);
        toast(`${e.joined ? 'Removed' : 'Deleted'} “${e.name}”`);
      }
    },
    useTemplate: async (e: Entry) => {
      const code = await createFlow({ name: `Round ${flowCount + 1}`, mode: e.mode, from: locOf(e) });
      nav(`/f/${code}`);
    },
  };

  const newTemplate = async () => {
    const v = await promptDialog('New template', 'My case', 'Create');
    if (!v) return;
    const id = await createTemplate({ name: v, mode: 'aff' });
    nav(`/t/${id}`);
  };

  return (
    <div className="flex h-full flex-col">
      <HomeHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{kind === 'flow' ? 'Your flows' : 'Templates'}</h1>
            <p className="t2 mt-1 text-[13px]">
              {kind === 'flow'
                ? 'Open a flow to get its code, then share the code with your partner to flow together live.'
                : 'Preflow skeletons: tabs, mode and prepared case/blocks. Start a new flow from any of them.'}
            </p>
          </div>
          <button className="btn btn-primary !px-3.5 !py-2" onClick={() => (kind === 'flow' ? setCreating(true) : newTemplate())} data-testid="new-doc">
            <Icon.plus /> New {label}
          </button>
        </div>
        {kind === 'flow' && <JoinBox />}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <span className="t3 absolute left-3 top-1/2 -translate-y-1/2">
              <Icon.search />
            </span>
            <input className="input !pl-9" placeholder={`Search ${label}s`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="updated">Last edited</option>
            <option value="created">Date created</option>
            <option value="name">Name</option>
          </select>
        </div>

        {!status.loaded ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel h-[62px] animate-pulse rounded-xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="panel flex flex-col items-center rounded-xl px-6 py-16 text-center">
            <div className="mb-3 rounded-xl bg-[var(--panel-2)] p-3 t2">{kind === 'flow' ? <Icon.flow /> : <Icon.template />}</div>
            <div className="text-[15px] font-semibold">{q ? 'No matches' : kind === 'flow' ? 'No flows yet' : 'No templates yet'}</div>
            <div className="t2 mt-1 max-w-sm text-[13px]">
              {q
                ? 'Try a different search.'
                : kind === 'flow'
                  ? 'Create a flow, or join your partner’s with the code from their flow.'
                  : 'Build a template with your case already in the constructive column, or open a flow and click “Save as template”.'}
            </div>
            {!q && (
              <button className="btn btn-primary mt-5" onClick={() => (kind === 'flow' ? setCreating(true) : newTemplate())}>
                <Icon.plus /> New {label}
              </button>
            )}
          </div>
        ) : (
          <div className="panel divide-y overflow-hidden rounded-xl" style={{ borderColor: 'var(--border)' }}>
            {list.map((e) => (
              <div
                key={e.id}
                className="group flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--hover-bg)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => open(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setMenu({ x: ev.clientX, y: ev.clientY, e });
                }}
                data-testid="doc-row"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{e.name}</div>
                  <div className="t3 mt-0.5 text-[12px]">
                    Edited {timeAgo(e.updatedAt)} · created {new Date(e.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {e.code && <span className="ml-2 font-mono tracking-wider">{e.code}</span>}
                  </div>
                </div>
                {e.joined && <span className="t2 rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-[11.5px] font-medium">Shared with you</span>}
                <ModeBadge mode={e.mode} />
                {kind === 'template' && (
                  <button
                    className="btn btn-outline opacity-0 group-hover:opacity-100"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      act.useTemplate(e);
                    }}
                  >
                    New flow from this
                  </button>
                )}
                <button
                  className="btn !p-1.5 opacity-60 group-hover:opacity-100"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setMenu({ x: ev.clientX - 180, y: ev.clientY + 8, e });
                  }}
                  data-testid="row-menu"
                >
                  <Icon.dots />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => (setMenu(null), open(menu.e))}>Open</MenuItem>
          {kind === 'template' && <MenuItem onClick={() => (setMenu(null), act.useTemplate(menu.e))}>New flow from template</MenuItem>}
          {menu.e.code && (
            <MenuItem
              onClick={() => {
                navigator.clipboard?.writeText(menu.e.code!);
                toast('Flow code copied');
                setMenu(null);
              }}
            >
              Copy flow code
            </MenuItem>
          )}
          <MenuItem onClick={() => (setMenu(null), act.rename(menu.e))}>Rename</MenuItem>
          <MenuItem onClick={() => (setMenu(null), act.duplicate(menu.e))}>Duplicate</MenuItem>
          <MenuSep />
          <MenuItem danger onClick={() => (setMenu(null), act.remove(menu.e))}>
            {menu.e.joined ? 'Remove from dashboard' : 'Delete'}
          </MenuItem>
        </Menu>
      )}
      {creating && <NewFlowDialog templates={templates} count={flowCount} onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <span
      className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-medium"
      style={{ background: mode === 'aff' ? 'var(--aff-soft)' : 'var(--con-soft)', color: mode === 'aff' ? 'var(--aff)' : 'var(--con)' }}
    >
      {mode === 'aff' ? 'Aff first' : 'Con first'}
    </span>
  );
}

function NewFlowDialog({ templates, count, onClose }: { templates: Entry[]; count: number; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState(`Round ${count + 1}`);
  const [mode, setMode] = useState<Mode>('aff');
  const [tpl, setTpl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tplEntry = templates.find((t) => t.id === tpl);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const code = await createFlow({ name: name.trim() || `Round ${count + 1}`, mode, from: tplEntry ? locOf(tplEntry) : null });
    onClose();
    nav(`/f/${code}`);
  };
  return (
    <Modal onClose={onClose} title="New flow" width={480}>
      <form
        className="space-y-5 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <div className="mb-1.5 text-[12.5px] font-medium t2">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} placeholder="Round 3 vs Lincoln" />
        </label>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium t2">Who speaks first?</div>
          <div className="grid grid-cols-2 gap-2">
            {(['aff', 'con'] as Mode[]).map((m) => (
              <button
                type="button"
                key={m}
                className={cls('rounded-lg border px-3 py-2.5 text-left text-[13px] transition', mode === m ? 'font-semibold' : 'bd t2')}
                style={mode === m ? { borderColor: m === 'aff' ? 'var(--aff)' : 'var(--con)', background: m === 'aff' ? 'var(--aff-soft)' : 'var(--con-soft)' } : undefined}
                onClick={() => setMode(m)}
              >
                {m === 'aff' ? 'Aff' : 'Con'} speaks first
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium t2">Start from</div>
          <select className="input" value={tpl ?? ''} onChange={(e) => setTpl(e.target.value || null)} data-testid="template-select">
            <option value="">Blank flow (Aff + Con tabs)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                Template: {t.name}
              </option>
            ))}
          </select>
          {tplEntry && tplEntry.mode !== mode && (
            <div className="t3 mt-1.5 text-[12px]">This template was built {tplEntry.mode === 'aff' ? 'Aff' : 'Con'}-first; cells keep their column positions (constructives stay in column one).</div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-flow">
            {busy ? 'Creating…' : 'Create flow'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
