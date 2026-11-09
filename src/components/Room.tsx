import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { createDoc, deleteDocEntry, duplicateDoc, entriesMap, forgetLastRoom, readEntries, rememberRoom, renameDoc, roomIndex, type DocKind, type Entry } from '../lib/room';
import type { Mode } from '../lib/model';
import { useStore } from '../lib/store';
import { transport } from '../lib/transport';
import { useY } from '../lib/yhooks';
import { cls, timeAgo } from '../lib/util';
import { confirmDialog, Icon, Menu, MenuItem, MenuSep, Modal, promptDialog, StatusPill, toast } from './ui';
import { openSettings } from './SettingsPanel';
import { openShortcuts } from './Shortcuts';

export function RoomLayout() {
  const { code = '' } = useParams();
  useEffect(() => rememberRoom(code), [code]);
  return <Outlet />;
}

function RoomHeader({ code }: { code: string }) {
  const nav = useNavigate();
  const status = useStore(roomIndex(code).status);
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b bd px-6" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center gap-2.5">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        <span className="text-[15px] font-semibold tracking-tight">PF Flow</span>
      </div>
      <nav className="flex gap-1 text-[13px]">
        {[
          ['', 'Flows'],
          ['/templates', 'Templates'],
        ].map(([p, l]) => (
          <NavLink key={p} end to={`/r/${code}${p}`} className={({ isActive }) => cls('btn', isActive ? 'bg-[var(--panel-2)] font-semibold' : 't2')}>
            {l}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <StatusPill status={status} local={transport.kind === 'local'} />
        <button
          className="btn btn-outline font-mono tracking-wider"
          title="Room code — share with your partner. Click to copy."
          onClick={() => {
            navigator.clipboard?.writeText(code);
            toast('Room code copied');
          }}
          data-testid="room-code"
        >
          {code} <Icon.copy />
        </button>
        <button className="btn !p-1.5" onClick={openShortcuts} title="Keyboard shortcuts">
          <Icon.keyboard />
        </button>
        <button className="btn !p-1.5" onClick={openSettings} title="Settings">
          <Icon.gear />
        </button>
        <button
          className="btn t2"
          onClick={() => {
            forgetLastRoom();
            nav('/?switch=1');
          }}
        >
          Leave
        </button>
      </div>
    </header>
  );
}

type Sort = 'updated' | 'name' | 'created';

export function DocList({ kind }: { kind: DocKind }) {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const sync = roomIndex(code);
  const status = useStore(sync.status);
  const em = entriesMap(sync.doc);
  useY(em, true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; e: Entry } | null>(null);
  const all = readEntries(sync.doc);
  const templates = all.filter((e) => e.kind === 'template').sort((a, b) => a.name.localeCompare(b.name));
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const xs = all.filter((e) => e.kind === kind && (!ql || e.name.toLowerCase().includes(ql)));
    xs.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
    return xs;
  }, [JSON.stringify(all), q, sort, kind]);

  const path = (e: Entry) => `/r/${code}/${kind === 'flow' ? 'f' : 't'}/${e.id}`;
  const label = kind === 'flow' ? 'flow' : 'template';

  const act = {
    rename: async (e: Entry) => {
      const v = await promptDialog(`Rename ${label}`, e.name);
      if (v) await renameDoc(code, e.id, v);
    },
    duplicate: async (e: Entry) => {
      const id = await duplicateDoc(code, e.id, `${e.name} (copy)`, e.kind);
      toast('Duplicated');
      void id;
    },
    remove: async (e: Entry) => {
      if (await confirmDialog(`Delete “${e.name}”?`, `This permanently deletes the ${label} for both of you. This can't be undone.`, 'Delete', true)) {
        await deleteDocEntry(code, e.id);
        toast(`Deleted “${e.name}”`);
      }
    },
    useTemplate: async (e: Entry) => {
      const n = all.filter((x) => x.kind === 'flow').length + 1;
      const id = await createDoc(code, { name: `Round ${n}`, mode: e.mode, kind: 'flow', fromId: e.id });
      nav(`/r/${code}/f/${id}`);
    },
  };

  const newTemplate = async () => {
    const v = await promptDialog('New template', 'My case', 'Create');
    if (!v) return;
    const id = await createDoc(code, { name: v, mode: 'aff', kind: 'template' });
    nav(`/r/${code}/t/${id}`);
  };

  return (
    <div className="flex h-full flex-col">
      <RoomHeader code={code} />
      <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{kind === 'flow' ? 'Flows' : 'Templates'}</h1>
            <p className="t2 mt-1 text-[13px]">
              {kind === 'flow'
                ? 'Every round your team has flowed. Shared live with anyone in this room.'
                : 'Preflow skeletons: tabs, mode and prepared case/blocks. Start a new flow from any of them.'}
            </p>
          </div>
          <button className="btn btn-primary !px-3.5 !py-2" onClick={() => (kind === 'flow' ? setCreating(true) : newTemplate())} data-testid="new-doc">
            <Icon.plus /> New {label}
          </button>
        </div>
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
                  ? 'Create your first flow. Your partner will see it here the moment it exists.'
                  : 'Build a template with your case already in the constructive column, or open a flow and click “Save as template”.'}
            </div>
            {!q && (
              <button className="btn btn-primary mt-5" onClick={() => (kind === 'flow' ? setCreating(true) : newTemplate())}>
                <Icon.plus /> New {label}
              </button>
            )}
            {!status.serverSynced && status.net !== 'offline' && transport.kind !== 'local' && <div className="t3 mt-4 text-[12px]">Checking the room for {label}s…</div>}
          </div>
        ) : (
          <div className="panel divide-y overflow-hidden rounded-xl" style={{ borderColor: 'var(--border)' }}>
            {list.map((e) => (
              <div
                key={e.id}
                className="group flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--hover-bg)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => nav(path(e))}
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
                  </div>
                </div>
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
          <MenuItem onClick={() => (setMenu(null), nav(path(menu.e)))}>Open</MenuItem>
          {kind === 'template' && <MenuItem onClick={() => (setMenu(null), act.useTemplate(menu.e))}>New flow from template</MenuItem>}
          <MenuItem onClick={() => (setMenu(null), act.rename(menu.e))}>Rename</MenuItem>
          <MenuItem onClick={() => (setMenu(null), act.duplicate(menu.e))}>Duplicate</MenuItem>
          <MenuSep />
          <MenuItem danger onClick={() => (setMenu(null), act.remove(menu.e))}>
            Delete
          </MenuItem>
        </Menu>
      )}
      {creating && <NewFlowDialog code={code} templates={templates} count={all.filter((e) => e.kind === 'flow').length} onClose={() => setCreating(false)} />}
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

function NewFlowDialog({ code, templates, count, onClose }: { code: string; templates: Entry[]; count: number; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState(`Round ${count + 1}`);
  const [mode, setMode] = useState<Mode>('aff');
  const [tpl, setTpl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const id = await createDoc(code, { name: name.trim() || `Round ${count + 1}`, mode, kind: 'flow', fromId: tpl });
    onClose();
    nav(`/r/${code}/f/${id}`);
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
          {tpl && templates.find((t) => t.id === tpl)?.mode !== mode && (
            <div className="t3 mt-1.5 text-[12px]">This template was built {templates.find((t) => t.id === tpl)?.mode === 'aff' ? 'Aff' : 'Con'}-first; cells keep their column positions (constructives stay in column one).</div>
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
