import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Keep a small, redacted diagnostic trail so native WebView startup failures
// are visible on-device instead of being hidden behind the generic timeout.
declare global {
  interface Window {
    __monetraDiagnostics?: string[];
    __monetraRecordDiagnostic?: (message: string) => void;
  }
}

window.__monetraDiagnostics = [];
window.__monetraRecordDiagnostic = (message: string) => {
  const safe = String(message)
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(pk_(?:test|live)_[A-Za-z0-9_-]+)/g, '[publishable-key]')
    .replace(/[?&](?:token|__clerk_db_jwt|authorization)=[^&\s]+/gi, '?[redacted]');
  window.__monetraDiagnostics = [...(window.__monetraDiagnostics || []), safe.slice(0, 360)].slice(-8);
};

window.addEventListener('error', (event) => {
  const target = event.target as HTMLElement | null;
  const resource = target && ('src' in target || 'href' in target)
    ? String(('src' in target ? (target as HTMLScriptElement).src : (target as HTMLLinkElement).href) || '')
    : '';
  window.__monetraRecordDiagnostic?.(
    event instanceof ErrorEvent
      ? `window.error: ${event.message || 'unknown'} at ${event.filename || 'unknown'}:${event.lineno || 0}`
      : `resource.error: ${resource ? new URL(resource, window.location.href).hostname + new URL(resource, window.location.href).pathname : target?.tagName || 'unknown resource'}`,
  );
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  window.__monetraRecordDiagnostic?.(
    `unhandledrejection: ${reason instanceof Error ? reason.name + ': ' + reason.message : String(reason)}`,
  );
});

function MissingConfiguration() {
  return (
    <main className="screen center">
      <div className="brand-mark">M</div>
      <h1>Monetra needs its sign-in configuration</h1>
      <p>Set VITE_CLERK_PUBLISHABLE_KEY in the Android build environment, then rebuild the app.</p>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  publishableKey
    ? <React.StrictMode><ClerkProvider publishableKey={publishableKey} standardBrowser={false}><App /></ClerkProvider></React.StrictMode>
    : <MissingConfiguration />,
);
