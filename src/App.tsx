import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DocList } from './components/Room';
import { FlowPage } from './components/FlowPage';
import { DialogHost, PresenceToastHost, ToastHost } from './components/ui';
import { ShortcutsHost } from './components/Shortcuts';
import { SettingsHost } from './components/SettingsPanel';
import { NamePrompt } from './components/NamePrompt';
import { flushPendingRooms, homeIndex } from './lib/room';
import { calibrateClock } from './lib/transport';

/** Old /r/CODE links (shared rooms, v1) are adopted as home in homeCode(); just go to the dashboard. */
function LegacyRoom() {
  return <Navigate to="/" replace />;
}

export default function App() {
  homeIndex(); // open your dashboard doc right away
  useEffect(() => {
    flushPendingRooms();
    window.addEventListener('online', flushPendingRooms);
    calibrateClock();
    const iv = setInterval(calibrateClock, 5 * 60_000);
    window.addEventListener('online', calibrateClock);
    return () => clearInterval(iv);
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DocList kind="flow" />} />
        <Route path="/templates" element={<DocList kind="template" />} />
        <Route path="/f/:code" element={<FlowPage kind="flow" />} />
        <Route path="/t/:id" element={<FlowPage kind="template" />} />
        <Route path="/r/:code/*" element={<LegacyRoom />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DialogHost />
      <ToastHost />
      <PresenceToastHost />
      <ShortcutsHost />
      <SettingsHost />
      <NamePrompt />
    </BrowserRouter>
  );
}
