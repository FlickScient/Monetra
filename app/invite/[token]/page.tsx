'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

export default function AcceptInvitationPage() {
  const params = useParams();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useUser();
  const token = typeof params.token === 'string' ? params.token : '';
  const [state, setState] = useState<'loading' | 'sign-in' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Checking your invitation…');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState('sign-in');
      setMessage('Sign in with the verified email address this invitation was sent to.');
      return;
    }

    let cancelled = false;
    async function accept() {
      try {
        const response = await fetch('/api/organizations/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setState('error');
          setMessage(data.error || 'This invitation could not be accepted.');
          return;
        }
        setState('success');
        setMessage(`You now have access to ${data.organization?.name || 'the shared space'}.`);
      } catch {
        if (!cancelled) {
          setState('error');
          setMessage('Connection issue. Please try again.');
        }
      }
    }

    void accept();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, token]);

  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`;

  return <main className="loading-screen">
    <section className="surface-card" style={{ width: 'min(92vw, 440px)', padding: 30, textAlign: 'center' }}>
      <div className="loading-mark">M</div>
      <p className="eyebrow">MONETRA WORKSPACE</p>
      <h1 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 24 }}>Workspace invitation</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>{message}</p>
      {state === 'sign-in' && <Link className="primary-btn" href={signInUrl}>Sign in to accept</Link>}
      {state === 'success' && <button className="primary-btn" onClick={() => router.push('/')}>Open Monetra</button>}
      {state === 'error' && <Link className="text-action" href="/">Return to Monetra</Link>}
    </section>
  </main>;
}
