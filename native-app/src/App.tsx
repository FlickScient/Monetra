import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useSignIn, useSignUp, useSSO } from 'capacitor-clerk';
import {
  getLastNativeSessionOwner,
  hasNativeAppPin,
  isNativeFinanceApp,
  listCachedNativeWorkspaces,
  queueNativeDebtPayment,
  queueNativeTransaction,
  queueNativeTransfer,
  readCachedNativeWorkspace,
  setNativeAppPin,
  syncNativeWorkspace,
  verifyNativeAppPin,
  type CachedFinanceData,
  type CachedWorkspace,
} from '@/lib/offline/native-finance';
import { configureFinanceSyncClient } from '@/lib/offline/sync-client';
import HomePage from '@/app/page';

const API_BASE = (import.meta.env.VITE_MONETRA_API_URL || 'https://monetra-4rax.vercel.app').replace(/\/+$/, '');
type Wallet = { id: string; name: string; walletType?: string; currentBalanceMinor?: number; currency?: string; status?: string };
type Category = { id: string; name: string; categoryType: 'income' | 'expense' };
type Transaction = { id: string; transactionType: string; amountMinor: number; description?: string; occurredAt?: string; walletId?: string; pendingSync?: boolean };
type Debt = { id: string; counterpartyName?: string; direction?: 'receivable' | 'payable'; principalMinor?: number; status?: string };
type DebtPayment = { id: string; dueDebtId: string; amountMinor: number };
type Mode = 'checking' | 'sign-in' | 'prepare' | 'setup-pin' | 'unlock' | 'dashboard' | 'error';
type AppView = 'home' | 'activity' | 'insights' | 'debts' | 'fiscus' | 'settings';
type FiscusMessage = { role: 'user' | 'model'; content: string };

function money(minor: number): string {
  return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format((minor || 0) / 100);
}
function asRows<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function transactionWalletLabel(wallets: Wallet[], id?: string): string { return wallets.find((item) => item.id === id)?.name || 'Wallet'; }

async function invokeNativeFiscus(getToken: () => Promise<string | null>, workspaceId: string, action: 'chat' | 'restore' | 'new', payload: Record<string, unknown> = {}) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://osfitgjwkjhhexgcazwj.supabase.co';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) throw new Error('Fiscus is not configured in this Android build yet.');
  const token = await getToken();
  if (!token) throw new Error('Sign in to use Fiscus AI.');
  const response = await fetch(baseUrl.replace(/\/+$/, '') + '/functions/v1/fiscus-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: publishableKey },
    body: JSON.stringify({ ...payload, action, workspaceId }),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Fiscus could not complete the request.');
  return result;
}

function NativeAuthScreen() {
  const { signIn, errors: signInErrors, fetchStatus: signInStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [screen, setScreen] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [authError, setAuthError] = useState('');

  const googleSignIn = async () => {
    setAuthError('');
    setBusyGoogle(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: 'monetra://sso-callback',
      });
      if (!createdSessionId || !setActive) {
        throw new Error('Google sign-in was closed before it finished. Try again.');
      }
      await setActive({ session: createdSessionId });
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'Google sign-in could not be completed.');
    } finally {
      setBusyGoogle(false);
    }
  };

  const submitSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError('');
    const { error: resultError } = await signIn.password({ identifier: email.trim(), password });
    if (resultError) setAuthError(resultError.message);
    else if (signIn.status === 'complete') await signIn.finalize({ navigate: () => undefined });
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError('');
    const { error: resultError } = await signUp.password({ emailAddress: email.trim(), password });
    if (resultError) {
      setAuthError(resultError.message);
      return;
    }
    const { error: codeError } = await signUp.verifications.sendEmailCode();
    if (codeError) setAuthError(codeError.message);
  };

  const verifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError('');
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code: verificationCode.trim() });
    if (verifyError) {
      setAuthError(verifyError.message);
      return;
    }
    if (signUp.status === 'complete') await signUp.finalize({ navigate: () => undefined });
  };

  const verifying = signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address');
  const busy = busyGoogle || signInStatus === 'fetching' || signUpStatus === 'fetching';

  return (
    <main className="screen auth-screen">
      <div className="brand-mark">M</div>
      <h1>Welcome to Monetra</h1>
      <p>Sign in once to securely download your finance workspace for offline use.</p>
      <section className="auth-card">
        {verifying ? (
          <form className="auth-form" onSubmit={verifyEmail}>
            <h2>Verify your email</h2>
            <p>Enter the verification code sent to {email}.</p>
            <label className="auth-field">Verification code
              <input className="auth-input" inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} required />
            </label>
            <button className="auth-primary" type="submit" disabled={busy}>Verify email</button>
            <button className="auth-link" type="button" onClick={() => void signUp.verifications.sendEmailCode()}>Resend code</button>
          </form>
        ) : (
          <>
            <div className="auth-tabs">
              <button type="button" className={screen === 'sign-in' ? 'active' : ''} onClick={() => { setScreen('sign-in'); setAuthError(''); }}>Sign in</button>
              <button type="button" className={screen === 'sign-up' ? 'active' : ''} onClick={() => { setScreen('sign-up'); setAuthError(''); }}>Create account</button>
            </div>
            <button className="auth-google" type="button" onClick={() => void googleSignIn()} disabled={busy}>
              <span className="google-g" aria-hidden="true">G</span>
              {busyGoogle ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <div className="auth-divider"><span>or use email</span></div>
            <form className="auth-form" onSubmit={screen === 'sign-in' ? submitSignIn : createAccount}>
              <label className="auth-field">Email address
                <input className="auth-input" type="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label className="auth-field">Password
                <input className="auth-input" type="password" autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
              <button className="auth-primary" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : screen === 'sign-in' ? 'Sign in with email' : 'Create account'}
              </button>
            </form>
          </>
        )}
        {(authError || signInErrors.global?.[0]?.message || signUpErrors.global?.[0]?.message) && (
          <div className="auth-error">{authError || signInErrors.global?.[0]?.message || signUpErrors.global?.[0]?.message}</div>
        )}
      </section>
      <p className="auth-footnote">Your account and finance data stay linked to the same Monetra profile.</p>
    </main>
  );
}

export default function App() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [mode, setMode] = useState<Mode>('checking');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<CachedWorkspace | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<CachedWorkspace[]>([]);
  const [data, setData] = useState<CachedFinanceData | null>(null);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [kind, setKind] = useState<'income' | 'expense' | 'transfer' | 'debt'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [walletId, setWalletId] = useState('');
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [debtId, setDebtId] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AppView>('home');
  const [activitySearch, setActivitySearch] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [fiscusMessages, setFiscusMessages] = useState<FiscusMessage[]>([]);
  const [fiscusDraft, setFiscusDraft] = useState('');
  const [fiscusLoading, setFiscusLoading] = useState(false);
  const [fiscusReady, setFiscusReady] = useState(false);
  const [fiscusError, setFiscusError] = useState('');
  const initialized = useRef(false);

  const wallets = useMemo(() => asRows<Wallet>(data?.wallets).filter((item) => item.status !== 'inactive'), [data]);
  const categories = useMemo(() => asRows<Category>(data?.categories), [data]);
  const transactions = useMemo(() => asRows<Transaction>(data?.transactions).slice().sort((a,b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))), [data]);
  const debts = useMemo(() => asRows<Debt>(data?.dueDebts).filter((item) => item.status !== 'settled' && item.status !== 'archived'), [data]);
  const debtPayments = useMemo(() => asRows<DebtPayment>(data?.dueDebtPayments), [data]);
  const paidForDebt = (debtId: string) => debtPayments.filter((payment) => payment.dueDebtId === debtId).reduce((sum, payment) => sum + Number(payment.amountMinor || 0), 0);
  const totalBalance = wallets.reduce((sum, item) => sum + Number(item.currentBalanceMinor || 0), 0);
  const filteredTransactions = transactions.filter((item) => {
    const matchesType = activityFilter === 'all' || item.transactionType === activityFilter;
    const needle = activitySearch.trim().toLowerCase();
    const matchesSearch = !needle || [item.description, item.transactionType, transactionWalletLabel(wallets, item.walletId)].some((value) => String(value || '').toLowerCase().includes(needle));
    return matchesType && matchesSearch;
  });
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthTransactions = transactions.filter((item) => String(item.occurredAt || '').slice(0, 7) === monthKey);
  const monthIncome = monthTransactions.filter((item) => item.transactionType === 'income').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
  const monthExpense = monthTransactions.filter((item) => item.transactionType === 'expense').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
  const openDebtTotal = debts.reduce((sum, item) => sum + Math.max(0, Number(item.principalMinor || 0) - paidForDebt(item.id)), 0);

  const configureSync = useCallback(() => {
    configureFinanceSyncClient({
      apiBaseUrl: API_BASE,
      getSessionToken: async () => getToken(),
    });
  }, [getToken]);

  const loadLocal = useCallback(async (workspaceId: string) => {
    const cached = await readCachedNativeWorkspace(workspaceId);
    setData(cached);
    setWorkspace((await listCachedNativeWorkspaces(ownerId || userId || '')).find((item) => item.id === workspaceId) || null);
    const firstWallet = asRows<Wallet>(cached.wallets)[0];
    if (firstWallet) setWalletId((current) => current || firstWallet.id);
    const firstDebt = asRows<Debt>(cached.dueDebts)[0];
    if (firstDebt) setDebtId((current) => current || firstDebt.id);
  }, [ownerId, userId]);

  useEffect(() => {
    if (isLoaded && !isSignedIn && navigator.onLine && mode === 'checking') {
      setMode('sign-in');
    }
  }, [isLoaded, isSignedIn, mode]);

  // Never leave the native launch screen spinning forever if Clerk's Frontend
  // API cannot be reached or its client fails to initialize inside Android WebView.
  useEffect(() => {
    if (mode !== 'checking' || isLoaded) return;
    const timeout = window.setTimeout(() => {
      const diagnostics = (window.__monetraDiagnostics || []).slice(-6);
      const environment = `Environment: ${window.location.protocol} · online=${navigator.onLine} · Clerk key configured=${Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)}`;
      setError([
        'Clerk did not finish initializing within 20 seconds.',
        environment,
        diagnostics.length ? 'Captured startup diagnostics:\n' + diagnostics.join('\n') : 'No browser error event was captured. The next useful check is the Clerk Frontend API request from this WebView.',
      ].join('\n\n'));
      setMode('error');
    }, 20000);
    return () => window.clearTimeout(timeout);
  }, [mode, isLoaded]);

  useEffect(() => {
    if (!isNativeFinanceApp()) {
      setError('This screen is designed for the installed Monetra Android app.');
      setMode('error');
      return;
    }
    if (!navigator.onLine) {
      void (async () => {
        try {
          const lastOwner = await getLastNativeSessionOwner();
          if (!lastOwner) {
            setError('This device has no downloaded Monetra workspace yet. Connect to the internet and sign in once.');
            setMode('error');
            return;
          }
          setOwnerId(lastOwner);
          const localWorkspaces = await listCachedNativeWorkspaces(lastOwner);
          setAvailableWorkspaces(localWorkspaces);
          const selected = localWorkspaces.find((item) => item.type === 'personal') || localWorkspaces[0];
          if (!selected) throw new Error('No saved workspace was found on this device.');
          setWorkspace(selected);
          if (!(await hasNativeAppPin(lastOwner))) {
            setError('This device has no local unlock PIN. Reconnect and sign in to finish secure offline setup.');
            setMode('error');
            return;
          }
          setMode('unlock');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not open the offline workspace.');
          setMode('error');
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId || initialized.current || !navigator.onLine) return;
    initialized.current = true;
    void (async () => {
      setMode('prepare');
      setError('');
      setOwnerId(userId);
      configureSync();
      try {
        const token = await getToken();
        if (!token) throw new Error('Your Clerk session is not ready. Sign in again.');
        const response = await fetch(API_BASE + '/api/workspaces', {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store',
        });
        const rows = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(rows)) throw new Error(rows?.error || 'Could not load your Monetra workspaces.');
        setAvailableWorkspaces(rows as CachedWorkspace[]);
        const selected = (rows as CachedWorkspace[]).find((item) => item.type === 'personal') || (rows as CachedWorkspace[])[0];
        if (!selected?.id) throw new Error('No personal workspace is available for this account.');
        await syncNativeWorkspace(userId, selected.id);
        setWorkspace(selected);
        const hasPin = await hasNativeAppPin(userId);
        setMode(hasPin ? 'unlock' : 'setup-pin');
      } catch (cause) {
        try {
          const cached = await listCachedNativeWorkspaces(userId);
          setAvailableWorkspaces(cached);
          const selectedCached = cached.find((item) => item.type === 'personal') || cached[0];
          if (selectedCached && await hasNativeAppPin(userId)) {
            setWorkspace(selectedCached);
            setMessage('Network sync is unavailable. You can still unlock your saved local workspace.');
            setMode('unlock');
            return;
          }
        } catch {
          // Show the original preparation error if no valid local snapshot can be opened.
        }
        setError(cause instanceof Error ? cause.message : 'Could not prepare the offline workspace.');
        setMode('error');
      }
    })();
  }, [isLoaded, isSignedIn, userId, configureSync, getToken]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownerId || pin.length !== 6) return;
    setBusy(true); setError('');
    try {
      const valid = await verifyNativeAppPin(ownerId, pin);
      if (!valid) throw new Error('That PIN is incorrect.');
      if (!workspace) {
        const rows = await listCachedNativeWorkspaces(ownerId);
        setWorkspace(rows.find((item) => item.type === 'personal') || rows[0] || null);
      }
      const selected = workspace || (await listCachedNativeWorkspaces(ownerId)).find((item) => item.type === 'personal') || (await listCachedNativeWorkspaces(ownerId))[0];
      if (!selected) throw new Error('No local workspace is available.');
      await loadLocal(selected.id);
      if (navigator.onLine && isSignedIn) {
        configureSync();
        try {
          await syncNativeWorkspace(ownerId, selected.id);
          await loadLocal(selected.id);
          setMessage('Synced with your Monetra account.');
        } catch {
          setMessage('Unlocked locally. Sync is pending until your connection is stable.');
        }
      } else {
        setMessage('Offline mode · changes stay on this device until you reconnect.');
      }
      setMode('dashboard');
      setPin('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unlock Monetra.');
    } finally { setBusy(false); }
  };

  const createPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownerId || pin.length !== 6 || pin !== pinConfirm) {
      setError('Enter and confirm the same six-digit PIN.');
      return;
    }
    setBusy(true); setError('');
    try {
      await setNativeAppPin(ownerId, pin);
      setPin(''); setPinConfirm('');
      setMode('dashboard');
      if (workspace) await loadLocal(workspace.id);
      setMessage('Local app lock enabled. Your finance snapshot is saved on this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not set the local PIN.');
    } finally { setBusy(false); }
  };

  const switchWorkspace = async (workspaceId: string) => {
    const selected = availableWorkspaces.find((item) => item.id === workspaceId);
    if (!selected || selected.id === workspace?.id || !ownerId) return;
    setBusy(true); setError('');
    try {
      if (navigator.onLine && isSignedIn) {
        configureSync();
        await syncNativeWorkspace(ownerId, selected.id);
      }
      const cached = await readCachedNativeWorkspace(selected.id);
      setWorkspace(selected); setData(cached); setView('home');
      setWalletId(asRows<Wallet>(cached.wallets)[0]?.id || '');
      setDebtId(asRows<Debt>(cached.dueDebts)[0]?.id || '');
      setFiscusMessages([]); setFiscusReady(false); setFiscusError('');
      setMessage(navigator.onLine ? 'Workspace loaded and synced.' : 'Workspace switched · offline changes stay on this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not switch workspace.');
    } finally { setBusy(false); }
  };

  const refresh = async () => {
    if (!workspace) return;
    setBusy(true); setError('');
    try {
      if (navigator.onLine && isSignedIn && ownerId) {
        configureSync();
        await syncNativeWorkspace(ownerId, workspace.id);
        setMessage('Sync complete.');
      } else {
        setMessage('Still offline. Your local changes are safely queued.');
      }
      await loadLocal(workspace.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sync failed. Local changes remain queued.');
    } finally { setBusy(false); }
  };

  // Resume sync when Android returns to the foreground or connectivity is restored.
  useEffect(() => {
    if (!workspace || !ownerId || !isSignedIn) return;
    let running = false;
    let disposed = false;
    const resumeSync = async () => {
      if (running || disposed || !navigator.onLine || document.visibilityState === 'hidden') return;
      running = true;
      try {
        configureSync();
        await syncNativeWorkspace(ownerId, workspace.id);
        if (!disposed) {
          await loadLocal(workspace.id);
          setMessage('Connection restored · your local changes are synced.');
        }
      } catch {
        if (!disposed) setMessage('Connection restored · some changes are still waiting to sync.');
      } finally {
        running = false;
      }
    };
    window.addEventListener('online', resumeSync);
    document.addEventListener('visibilitychange', resumeSync);
    return () => {
      disposed = true;
      window.removeEventListener('online', resumeSync);
      document.removeEventListener('visibilitychange', resumeSync);
    };
  }, [workspace, ownerId, isSignedIn, configureSync, loadLocal]);

  useEffect(() => {
    if (view !== 'fiscus' || !workspace || !isSignedIn || fiscusReady) return;
    let cancelled = false;
    setFiscusLoading(true);
    setFiscusError('');
    void invokeNativeFiscus(getToken, workspace.id, 'restore')
      .then((result) => {
        if (cancelled) return;
        const restored = Array.isArray(result.messages) ? result.messages.filter((item: FiscusMessage) => item && (item.role === 'user' || item.role === 'model') && typeof item.content === 'string').slice(-40) : [];
        setFiscusMessages(restored);
        setFiscusReady(true);
      })
      .catch((cause) => { if (!cancelled) { setFiscusError(cause instanceof Error ? cause.message : 'Fiscus could not load your chat.'); setFiscusReady(true); } })
      .finally(() => { if (!cancelled) setFiscusLoading(false); });
    return () => { cancelled = true; };
  }, [view, workspace, isSignedIn, fiscusReady, getToken]);

  const sendFiscusMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = fiscusDraft.trim();
    if (!content || !workspace || !isSignedIn || fiscusLoading) return;
    const newUserMessage: FiscusMessage = { role: 'user', content };
    const next = [...fiscusMessages, newUserMessage].slice(-12);
    setFiscusMessages((current) => [...current, { role: 'user' as const, content }].slice(-40));
    setFiscusDraft(''); setFiscusError(''); setFiscusLoading(true);
    try {
      const result = await invokeNativeFiscus(getToken, workspace.id, 'chat', { messages: next });
      if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Fiscus returned an empty response.');
      setFiscusMessages((current) => [...current, { role: 'model' as const, content: result.answer as string }].slice(-40));
    } catch (cause) {
      // Keep the user's prompt recoverable when the request fails, and remove
      // only this optimistic bubble (not an older identical message).
      setFiscusMessages((current) => current.filter((item) => item !== newUserMessage));
      setFiscusDraft((current) => current || content);
      setFiscusError(cause instanceof Error ? cause.message : 'Fiscus could not complete the request.');
    } finally { setFiscusLoading(false); }
  };

  const startFiscusChat = async () => {
    if (!workspace || !isSignedIn || fiscusLoading) return;
    setFiscusLoading(true); setFiscusError('');
    try { await invokeNativeFiscus(getToken, workspace.id, 'new'); setFiscusMessages([]); setFiscusReady(true); }
    catch (cause) { setFiscusError(cause instanceof Error ? cause.message : 'Could not start a new chat.'); }
    finally { setFiscusLoading(false); }
  };

  const saveEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace || !ownerId) return;
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    setBusy(true); setError('');
    const operationId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    let queuedLocally = false;
    try {
      if (kind === 'income' || kind === 'expense') {
        await queueNativeTransaction(workspace.id, {
          operationId, walletId, transactionType: kind, categoryId: categoryId || null,
          amountMinor, description: description.trim() || (kind === 'income' ? 'Income' : 'Expense'), occurredAt,
        });
      } else if (kind === 'transfer') {
        await queueNativeTransfer(workspace.id, {
          operationId, walletId, destinationWalletId, amountMinor,
          description: description.trim() || 'Transfer', occurredAt,
        });
      } else {
        await queueNativeDebtPayment(workspace.id, {
          operationId, dueDebtId: debtId, amountMinor, paidAt: occurredAt, note: description.trim() || null,
        });
      }
      queuedLocally = true;
      setAmount(''); setDescription('');
      setMessage(navigator.onLine ? 'Saved locally. Syncing…' : 'Saved offline on this device.');
      await loadLocal(workspace.id);
      if (navigator.onLine && isSignedIn) {
        configureSync();
        try {
          await syncNativeWorkspace(ownerId, workspace.id);
          await loadLocal(workspace.id);
          setMessage('Saved and synced.');
        } catch {
          setMessage('Saved on this device. Sync will retry when your connection is stable.');
        }
      }
    } catch (cause) {
      setError(queuedLocally
        ? 'Your entry is saved locally, but the screen could not refresh. Reopen Monetra to verify it.'
        : cause instanceof Error ? cause.message : 'Could not save this entry.');
    } finally { setBusy(false); }
  };

  if (mode === 'checking' || mode === 'prepare') {
    return <main className="screen center"><div className="brand-mark">M</div><div className="spinner" /><h1>{mode === 'prepare' ? 'Preparing your offline vault' : 'Opening Monetra'}</h1><p>Securing your local finance data…</p></main>;
  }
  if (mode === 'sign-in') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Welcome to Monetra</h1><p>Sign in once to download your finance workspace for offline use.</p><NativeAuthScreen /></main>;
  }
  if (mode === 'setup-pin') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Protect your offline vault</h1><p>Create a six-digit PIN. You’ll need it to open your saved finance data when you’re offline.</p><form className="pin-form" onSubmit={createPin}><input aria-label="Six-digit PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="••••••" /><input aria-label="Confirm PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="Confirm PIN" /><button disabled={busy || pin.length !== 6 || pinConfirm.length !== 6}>Enable offline lock</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'unlock') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Unlock Monetra</h1><p>{workspace?.name || 'Your saved workspace'} · Enter your device PIN to view local finance data.</p><form className="pin-form" onSubmit={unlock}><input aria-label="Six-digit PIN" autoFocus inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="••••••" /><button disabled={busy || pin.length !== 6}>{busy ? 'Unlocking…' : 'Unlock'}</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'error') return <main className="screen center"><div className="brand-mark">M</div><h1>Monetra couldn’t open</h1><pre className="error" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left', width: '100%', maxWidth: 520, fontSize: 12 }}>{error}</pre>{isLoaded && !isSignedIn && navigator.onLine && <button onClick={() => setMode('sign-in')}>Sign in</button>}<button className="secondary" onClick={() => window.location.reload()}>Try again</button></main>;

  // After the native sign-in + PIN gate, render the exact website finance experience.
  // Its own data adapter uses the same hosted APIs and the existing SQLite cache.
  return <HomePage />;

  // All native authentication/PIN states above are gates; the signed-in app is the website UI.
  return <HomePage />;
}
