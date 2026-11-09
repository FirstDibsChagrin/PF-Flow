import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { timersMap, type Mode } from '../lib/model';
import { readTimes, roomSettings } from '../lib/room';
import { patchSettings, useSettings } from '../lib/settings';
import { clockRemaining, fmt, readClock, resetClock, setSpeech, speechIndex, speechSequence, toggleClock, type TimerKey } from '../lib/timers';
import { useY } from '../lib/yhooks';
import { cls } from '../lib/util';
import { Icon } from './ui';

let audioCtx: AudioContext | null = null;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * 0.25);
      o.stop(t + i * 0.25 + 0.2);
    }
  } catch {}
}

export function useTimerControls(doc: Y.Doc, index: Y.Doc, mode: Mode) {
  const times = readTimes(index);
  const seq = speechSequence(mode);
  const idx = Math.min(speechIndex(doc), seq.length - 1);
  const speechMs = times[seq[idx].len] * 1000;
  const prepMs = times.prep * 1000;
  return {
    seq,
    idx,
    speechMs,
    prepMs,
    toggle: (k: TimerKey) => toggleClock(doc, k, k === 'speech' ? speechMs : prepMs),
    reset: (k: TimerKey) => resetClock(doc, k, k === 'speech' ? speechMs : prepMs),
    go: (i: number) => {
      const j = (i + seq.length) % seq.length;
      setSpeech(doc, j, times[seq[j].len] * 1000);
    },
  };
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => set((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, [active]);
}

function Clock(props: { k: TimerKey; label: string; full: number; doc: Y.Doc; onToggle: () => void; onReset: () => void; accent?: string; testid: string }) {
  const c = readClock(props.doc, props.k);
  const running = !!c && c.startedAt != null;
  useTick(running);
  const rem = clockRemaining(c, props.full);
  const sound = useSettings((s) => s.sound);
  const expired = rem <= 0;
  const [flash, setFlash] = useState(false);
  const wasPositive = useRef(rem > 0);
  useEffect(() => {
    if (wasPositive.current && rem <= 0 && running) {
      setFlash(true);
      if (sound) beep();
      setTimeout(() => setFlash(false), 3000);
    }
    wasPositive.current = rem > 0;
  }, [rem <= 0, running]);
  return (
    <div className={cls('flex items-center gap-1 rounded-lg px-1.5 py-1', flash && 'flash')} data-testid={props.testid}>
      <span className="t3 text-[11px] font-medium uppercase tracking-wide" style={props.accent ? { color: props.accent } : undefined}>
        {props.label}
      </span>
      <span
        className={cls('w-[52px] text-right font-mono text-[15px] font-semibold tabular-nums', expired && 'text-red-500')}
        data-testid={props.testid + '-time'}
      >
        {fmt(props.k === 'speech' ? rem : Math.max(0, rem))}
      </span>
      <button className="btn !p-1.5" onClick={props.onToggle} title={running ? 'Pause' : 'Start'}>
        {running ? <Icon.pause /> : <Icon.play />}
      </button>
      <button className="btn t3 !p-1.5" onClick={props.onReset} title="Reset">
        <Icon.reset />
      </button>
    </div>
  );
}

export function TimerBar({ doc, index, mode }: { doc: Y.Doc; index: Y.Doc; mode: Mode }) {
  useY(timersMap(doc));
  useY(roomSettings(index), true);
  const t = useTimerControls(doc, index, mode);
  const sound = useSettings((s) => s.sound);
  const slot = t.seq[t.idx];
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t bd px-3" style={{ background: 'var(--panel)' }} data-testid="timerbar">
      <div className="flex items-center gap-0.5">
        <button className="btn t3 !p-1.5" onClick={() => t.go(t.idx - 1)} title="Previous speech">
          <Icon.prev />
        </button>
        <select
          className="rounded-md border bd bg-transparent px-2 py-1 text-[12.5px] font-medium outline-none"
          style={{ background: 'var(--panel)' }}
          value={t.idx}
          onChange={(e) => t.go(Number(e.target.value))}
          data-testid="speech-select"
        >
          {t.seq.map((s, i) => (
            <option key={s.id} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn t3 !p-1.5" onClick={() => t.go(t.idx + 1)} title="Next speech">
          <Icon.next />
        </button>
      </div>
      <Clock k="speech" label={slot.short} full={t.speechMs} doc={doc} onToggle={() => t.toggle('speech')} onReset={() => t.reset('speech')} testid="clock-speech" />
      <div className="h-5 border-l bd" />
      <Clock k="prep-aff" label="Aff prep" accent="var(--aff)" full={t.prepMs} doc={doc} onToggle={() => t.toggle('prep-aff')} onReset={() => t.reset('prep-aff')} testid="clock-prep-aff" />
      <Clock k="prep-con" label="Con prep" accent="var(--con)" full={t.prepMs} doc={doc} onToggle={() => t.toggle('prep-con')} onReset={() => t.reset('prep-con')} testid="clock-prep-con" />
      <div className="ml-auto flex items-center gap-2">
        <span className="t3 hidden text-[11px] xl:inline">
          <span className="kbd">Alt</span> + <span className="kbd">S</span> speech · <span className="kbd">A</span>/<span className="kbd">C</span> prep
        </span>
        <button className="btn t3 !p-1.5" onClick={() => patchSettings({ sound: !sound })} title={sound ? 'Sound on' : 'Sound off'}>
          {sound ? <Icon.sound /> : <Icon.mute />}
        </button>
      </div>
    </div>
  );
}
