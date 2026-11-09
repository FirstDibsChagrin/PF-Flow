import { useParams } from 'react-router-dom';
import { LOCAL } from '../lib/sync';
import { DEFAULT_TIMES, readTimes, roomIndex, roomSettings, type TimerSettings } from '../lib/room';
import { patchSettings, USER_COLORS, useSettings, type Theme } from '../lib/settings';
import { Store, useStore } from '../lib/store';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { Modal } from './ui';

const open = new Store(false);
export const openSettings = () => open.set(true);

export function SettingsHost() {
  const isOpen = useStore(open);
  const { code } = useParams();
  if (!isOpen) return null;
  return (
    <Modal onClose={() => open.set(false)} title="Settings" width={520}>
      <SettingsBody room={code} />
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="t3 text-[11.5px]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsBody({ room }: { room?: string }) {
  const s = useSettings();
  return (
    <div className="px-5 py-3">
      <div className="t3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide">You (this device)</div>
      <Row label="Display name" hint="Shown to your partner">
        <input className="input !w-48 !py-1.5" value={s.name} onChange={(e) => patchSettings({ name: e.target.value.slice(0, 24) })} />
      </Row>
      <Row label="Cursor color">
        <div className="flex gap-1.5">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              className={cls('h-6 w-6 rounded-full ring-offset-2 transition', s.color === c && 'ring-2')}
              style={{ background: c, ['--tw-ring-color' as any]: c, ['--tw-ring-offset-color' as any]: 'var(--panel)' }}
              onClick={() => patchSettings({ color: c })}
            />
          ))}
        </div>
      </Row>
      <Row label="Theme">
        <div className="flex rounded-lg border bd p-0.5 text-[12px]">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={cls('rounded-md px-2.5 py-1 capitalize', s.theme === t ? 'bg-[var(--panel-2)] font-semibold' : 't2')} onClick={() => patchSettings({ theme: t })}>
              {t}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Cell font size" hint={`${s.fontSize}px`}>
        <input type="range" min={12} max={20} step={1} value={s.fontSize} onChange={(e) => patchSettings({ fontSize: Number(e.target.value) })} className="w-48 accent-[var(--accent)]" />
      </Row>
      <Row label="Column widths" hint="Drag column header edges to resize">
        <button className="btn btn-outline" onClick={() => patchSettings({ colWidths: {} })}>
          Reset widths
        </button>
      </Row>
      <Row label="Timer sound" hint="Beep when a timer runs out">
        <input type="checkbox" checked={s.sound} onChange={(e) => patchSettings({ sound: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
      </Row>
      {room && <TimerSettingsSection room={room} />}
    </div>
  );
}

const LABELS: [keyof TimerSettings, string][] = [
  ['C', 'Constructive'],
  ['R', 'Rebuttal'],
  ['S', 'Summary'],
  ['F', 'Final Focus'],
  ['CX', 'Crossfire'],
  ['GCX', 'Grand Crossfire'],
  ['prep', 'Prep (per team)'],
];

function TimerSettingsSection({ room }: { room: string }) {
  const index = roomIndex(room).doc;
  useY(roomSettings(index), true);
  const t = readTimes(index);
  const set = (k: keyof TimerSettings, sec: number) => {
    index.transact(() => roomSettings(index).set('times', { ...readTimes(index), [k]: sec }), LOCAL);
  };
  return (
    <>
      <div className="t3 flex items-center justify-between pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide">
        Timer lengths (shared with partner)
        <button className="btn !py-0.5 normal-case tracking-normal" onClick={() => index.transact(() => roomSettings(index).set('times', DEFAULT_TIMES), LOCAL)}>
          Defaults
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-6">
        {LABELS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
            <span>{label}</span>
            <span className="flex items-center gap-1">
              <input
                className="input !w-12 !px-1.5 !py-1 text-center font-mono"
                value={Math.floor(t[k] / 60)}
                onChange={(e) => set(k, (Number(e.target.value) || 0) * 60 + (t[k] % 60))}
              />
              :
              <input
                className="input !w-12 !px-1.5 !py-1 text-center font-mono"
                value={String(t[k] % 60).padStart(2, '0')}
                onChange={(e) => set(k, Math.floor(t[k] / 60) * 60 + Math.min(59, Number(e.target.value) || 0))}
              />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
