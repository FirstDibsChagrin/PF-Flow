import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isKnownRoom, LAST_ROOM_KEY } from '../lib/room';
import { transport } from '../lib/transport';
import { isValidRoomCode, newRoomCode, normalizeRoomCode } from '../lib/util';

export function Landing() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const last = (() => {
    try {
      return localStorage.getItem(LAST_ROOM_KEY);
    } catch {
      return null;
    }
  })();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setErr(''), [code]);
  if (last && !params.get('switch')) return <Navigate to={`/r/${last}`} replace />;

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      for (let i = 0; i < 5; i++) {
        const c = newRoomCode();
        if (await transport.createRoom(c)) return nav(`/r/${c}`);
      }
      setErr('Could not create a room. Try again.');
    } catch {
      setErr("You're offline. Creating a room needs a connection (joining a room you've used before works offline).");
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    if (!isValidRoomCode(c)) return setErr('Room codes are 8 characters, like K7QM2XPA.');
    setBusy(true);
    try {
      if (await transport.roomExists(c)) nav(`/r/${c}`);
      else setErr('No room with that code.');
    } catch {
      if (isKnownRoom(c)) nav(`/r/${c}`);
      else setErr("You're offline and haven't opened this room on this device before.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="text-[19px] font-semibold tracking-tight">PF Flow</div>
            <div className="t2 text-[13px]">Flow Public Forum rounds together, live.</div>
          </div>
        </div>
        <div className="panel rounded-2xl p-6 shadow-sm">
          <button className="btn btn-primary w-full justify-center !py-2.5 text-[14px]" onClick={create} disabled={busy} data-testid="create-room">
            Create a room
          </button>
          <div className="t3 my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider">
            <div className="h-px flex-1 bg-[var(--border)]" /> or join your partner <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
            className="flex gap-2"
          >
            <input
              className="input text-center font-mono text-[15px] uppercase tracking-[0.25em]"
              placeholder="ROOM CODE"
              maxLength={9}
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              data-testid="join-code"
            />
            <button className="btn btn-outline !px-4" disabled={busy || code.length < 8} data-testid="join-room">
              Join
            </button>
          </form>
          {err && <div className="mt-3 text-[12.5px] text-red-500">{err}</div>}
        </div>
        <p className="t3 mt-5 text-center text-[12px] leading-relaxed">
          No accounts. Anyone with the room code can view and edit everything in the room, so share it only with your partner.
        </p>
      </div>
    </div>
  );
}
