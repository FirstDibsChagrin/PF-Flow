import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Landing } from './components/Landing';
import { DocList, RoomLayout } from './components/Room';
import { FlowPage } from './components/FlowPage';
import { DialogHost, ToastHost } from './components/ui';
import { ShortcutsHost } from './components/Shortcuts';
import { SettingsHost } from './components/SettingsPanel';
import { NamePrompt } from './components/NamePrompt';
import { roomIndex } from './lib/room';
import { calibrateClock } from './lib/transport';
import { isValidRoomCode } from './lib/util';

function RoomGuard({ children }: { children: React.ReactNode }) {
  const { code = '' } = useParams();
  if (!isValidRoomCode(code)) return <Navigate to="/?switch=1" replace />;
  roomIndex(code); // open the room index doc
  return (
    <>
      {children}
      <SettingsHost />
      <NamePrompt />
    </>
  );
}

export default function App() {
  useEffect(() => {
    calibrateClock();
    const iv = setInterval(calibrateClock, 5 * 60_000);
    window.addEventListener('online', calibrateClock);
    return () => clearInterval(iv);
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/r/:code"
          element={
            <RoomGuard>
              <RoomLayout />
            </RoomGuard>
          }
        >
          <Route index element={<DocList kind="flow" />} />
          <Route path="templates" element={<DocList kind="template" />} />
          <Route path="f/:id" element={<FlowPage kind="flow" />} />
          <Route path="t/:id" element={<FlowPage kind="template" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DialogHost />
      <ToastHost />
      <ShortcutsHost />
    </BrowserRouter>
  );
}
