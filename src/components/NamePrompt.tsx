import { useState } from 'react';
import { patchSettings, USER_COLORS, useSettings } from '../lib/settings';
import { cls } from '../lib/util';

export function NamePrompt() {
  const s = useSettings();
  const [name, setName] = useState('');
  const [color, setColor] = useState(s.color);
  if (s.name) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <form
        className="panel fadein w-[380px] rounded-xl p-6 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) patchSettings({ name: name.trim().slice(0, 24), color });
        }}
      >
        <div className="text-[16px] font-semibold">What should your partner call you?</div>
        <div className="t2 mb-4 mt-1 text-[13px]">Shown next to your cursor. Saved on this device only.</div>
        <input className="input mb-4" autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="name-input" />
        <div className="mb-5 flex gap-2">
          {USER_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={cls('h-7 w-7 rounded-full ring-offset-2 transition', color === c && 'ring-2')}
              style={{ background: c, ['--tw-ring-color' as any]: c, ['--tw-ring-offset-color' as any]: 'var(--panel)' }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button className="btn btn-primary w-full justify-center !py-2" disabled={!name.trim()} data-testid="name-save">
          Continue
        </button>
      </form>
    </div>
  );
}
