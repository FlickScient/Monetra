import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

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
