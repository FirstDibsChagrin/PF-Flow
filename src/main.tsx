import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './lib/settings';

/** /?repair clears the offline app cache (service worker + caches). Your flows are kept. */
async function repair() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {}
  location.replace('/');
}

function CrashScreen({ error }: { error: unknown }) {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? (error.stack ?? '').split('\n').slice(1, 5).join('\n') : '';
  return (
    <div style={{ maxWidth: 640, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: 'var(--text)' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>PF Flow hit an error while loading</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 16 }}>
        Your flows are safe (they're stored on this device and on the server). Try Reload first; if that doesn't help, Repair clears the
        app's offline cache and reloads.
      </p>
      <pre style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {msg}
        {stack && '\n' + stack}
      </pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
        <button className="btn btn-outline" onClick={repair}>
          Repair app
        </button>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    console.error('[pf] crash', error);
  }
  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}

if (!(window as any).__pfRepairing) {
  (window as any).__pfStarted = true;
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
