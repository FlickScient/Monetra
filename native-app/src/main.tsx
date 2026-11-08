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

// Record Clerk Frontend API traffic without exposing headers, bodies, or query tokens.
const isClerkRequest = (rawUrl: string) => {
  try {
    return new URL(rawUrl, window.location.href).hostname.toLowerCase().includes('clerk');
  } catch {
    return false;
  }
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const request = args[0];
  const rawUrl = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  const method = (args[1]?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
  if (!isClerkRequest(rawUrl)) return originalFetch(...args);
  let endpoint = 'unknown';
  try {
    const parsed = new URL(rawUrl, window.location.href);
    endpoint = parsed.hostname + parsed.pathname;
  } catch { /* keep endpoint redacted */ }
  window.__monetraRecordDiagnostic?.(`clerk.fetch.start: ${method} ${endpoint}`);
  try {
    const response = await originalFetch(...args);
    window.__monetraRecordDiagnostic?.(`clerk.fetch.response: ${method} ${endpoint} status=${response.status} ok=${response.ok}`);
    return response;
  } catch (error) {
    window.__monetraRecordDiagnostic?.(`clerk.fetch.failed: ${method} ${endpoint} ${error instanceof Error ? error.name + ': ' + error.message : String(error)}`);
    throw error;
  }
};

const xhrOpen = XMLHttpRequest.prototype.open;
const xhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: [boolean?, string?, string?]) {
  const rawUrl = String(url);
  if (isClerkRequest(rawUrl)) {
    let endpoint = 'unknown';
    try {
      const parsed = new URL(rawUrl, window.location.href);
      endpoint = parsed.hostname + parsed.pathname;
    } catch { /* keep endpoint redacted */ }
    (this as XMLHttpRequest & { __monetraClerkRequest?: string }).__monetraClerkRequest = `${method.toUpperCase()} ${endpoint}`;
  }
  return xhrOpen.call(this, method, url, ...(rest as [boolean, string?, string?]));
};
XMLHttpRequest.prototype.send = function(...args: Parameters<XMLHttpRequest['send']>) {
  const request = this as XMLHttpRequest & { __monetraClerkRequest?: string };
  if (request.__monetraClerkRequest) {
    const label = request.__monetraClerkRequest;
    window.__monetraRecordDiagnostic?.(`clerk.xhr.start: ${label}`);
    this.addEventListener('loadend', () => {
      window.__monetraRecordDiagnostic?.(`clerk.xhr.complete: ${label} status=${this.status} readyState=${this.readyState}`);
    }, { once: true });
    this.addEventListener('error', () => window.__monetraRecordDiagnostic?.(`clerk.xhr.error: ${label} network error`), { once: true });
    this.addEventListener('timeout', () => window.__monetraRecordDiagnostic?.(`clerk.xhr.timeout: ${label}`), { once: true });
  }
  return xhrSend.apply(this, args);
};

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
