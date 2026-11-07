import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignIn, useAuth } from '@clerk/clerk-react';
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

const API_BASE = (import.meta.env.VITE_MONETRA_API_URL || 'https://monetra-4rax.vercel.app').replace(/\/+$/, '');
type Wallet = { id: string; name: string; walletType?: string; currentBalanceMinor?: number; currency?: string; status?: string };
type Category = { id: string; name: string; categoryType: 'income' | 'expense' };
type Transaction = { id: string; transactionType: string; amountMinor: number; description?: string; occurredAt?: string; walletId?: string; pendingSync?: boolean };
type Debt = { id: string; title?: string; name?: string; principalMinor?: number; paidMinor?: number; status?: string };
type Mode = 'checking' | 'sign-in' | 'prepare' | 'setup-pin' | 'unlock' | 'dashboard' | 'error';
type AppView = 'home' | 'activity' | 'insights' | 'debts' | 'fiscus' | 'settings';
type FiscusMessage = { role: 'user' | 'model'; content: string };

function money(minor: number): string {
  return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format((minor || 0) / 100);
}
function asRows<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function transactionWalletLabel(wallets: Wallet[], id?: string): string { return wallets.find((item) => item.id === id)?.name || 'Wallet'; }

async function invokeNativeFiscus(getToken: () => Promise<string | null>, workspaceId: string, action: 'chat' | 'restore' | 'new', payload: Record<string, unknown> = {}) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
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
  const openDebtTotal = debts.reduce((sum, item) => sum + Math.max(0, Number(item.principalMinor || 0) - Number(item.paidMinor || 0)), 0);

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
    const next = [...fiscusMessages, { role: 'user' as const, content }].slice(-12);
    setFiscusMessages((current) => [...current, { role: 'user', content }].slice(-40));
    setFiscusDraft(''); setFiscusError(''); setFiscusLoading(true);
    try {
      const result = await invokeNativeFiscus(getToken, workspace.id, 'chat', { messages: next });
      if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Fiscus returned an empty response.');
      setFiscusMessages((current) => [...current, { role: 'model', content: result.answer }].slice(-40));
    } catch (cause) {
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
          amountMinor, description: description.trim(), occurredAt,
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
    return <main className="screen center"><div className="brand-mark">M</div><h1>Welcome to Monetra</h1><p>Sign in once to download your finance workspace for offline use.</p><SignIn routing="hash" /></main>;
  }
  if (mode === 'setup-pin') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Protect your offline vault</h1><p>Create a six-digit PIN. You’ll need it to open your saved finance data when you’re offline.</p><form className="pin-form" onSubmit={createPin}><input aria-label="Six-digit PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="••••••" /><input aria-label="Confirm PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="Confirm PIN" /><button disabled={busy || pin.length !== 6 || pinConfirm.length !== 6}>Enable offline lock</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'unlock') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Unlock Monetra</h1><p>{workspace?.name || 'Your saved workspace'} · Enter your device PIN to view local finance data.</p><form className="pin-form" onSubmit={unlock}><input aria-label="Six-digit PIN" autoFocus inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="••••••" /><button disabled={busy || pin.length !== 6}>{busy ? 'Unlocking…' : 'Unlock'}</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'error') return <main className="screen center"><div className="brand-mark">M</div><h1>Monetra couldn’t open</h1><p>{error}</p>{isLoaded && !isSignedIn && navigator.onLine && <button onClick={() => setMode('sign-in')}>Sign in</button>}<button className="secondary" onClick={() => window.location.reload()}>Try again</button></main>;

  const transactionWallet = (id?: string) => wallets.find((item) => item.id === id)?.name || 'Wallet';
  return (
    <main className="app">
      <header className="topbar"><div className="brand"><div className="brand-mark small">M</div><div><b>Monetra</b><small>Local-first finance</small></div></div><div className="topbar-actions">{availableWorkspaces.length > 1 && <select className="workspace-select" aria-label="Switch workspace" value={workspace?.id || ''} onChange={(event) => void switchWorkspace(event.target.value)} disabled={busy}>{availableWorkspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<button className="sync-button" onClick={() => void refresh()} disabled={busy}>{busy ? 'Working…' : navigator.onLine ? 'Sync now' : 'Offline'}</button></div></header>
      <section className="hero"><span className="eyebrow">TOTAL WALLET BALANCE</span><h1>{money(totalBalance)}</h1><p>{navigator.onLine ? 'Your local vault is ready to sync.' : 'Saved on this device · no internet required.'}</p></section>
      {message && <p className="notice">{message}</p>}{error && <p className="error notice">{error}</p>}
      <nav className="native-nav" aria-label="Main navigation">{([['home','Home'],['activity','Activity'],['insights','Insights'],['debts','Due'],['fiscus','Fiscus'],['settings','Settings']] as const).map(([key,label]) => <button key={key} type="button" className={view===key?'active':''} onClick={() => setView(key)}>{label}</button>)}</nav>
      {view === 'home' && <>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">QUICK ENTRY</span><h2>Record activity</h2></div></div>
        <form className="entry-form" onSubmit={saveEntry}>
          <div className="segmented">{(['expense','income','transfer','debt'] as const).map((item) => <button type="button" key={item} className={kind===item?'selected':''} onClick={() => setKind(item)}>{item === 'debt' ? 'Debt payment' : item[0].toUpperCase()+item.slice(1)}</button>)}</div>
          <label>Amount (৳)<input required inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          {kind !== 'debt' && <label>{kind === 'transfer' ? 'From wallet' : 'Wallet'}<select required value={walletId} onChange={(e) => setWalletId(e.target.value)}><option value="">Choose wallet</option>{wallets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {kind === 'transfer' && <label>To wallet<select required value={destinationWalletId} onChange={(e) => setDestinationWalletId(e.target.value)}><option value="">Choose destination</option>{wallets.filter((item) => item.id !== walletId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {(kind === 'income' || kind === 'expense') && <label>Category<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Uncategorised</option>{categories.filter((item) => item.categoryType === kind).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {kind === 'debt' && <label>Debt<select required value={debtId} onChange={(e) => setDebtId(e.target.value)}><option value="">Choose debt</option>{debts.map((item) => <option key={item.id} value={item.id}>{item.title || item.name || 'Due'} · {money(Number(item.principalMinor || 0))}</option>)}</select></label>}
          <label>Description / note<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" maxLength={500} /></label>
          <button className="primary" disabled={busy || !amount || (kind !== 'debt' && !walletId) || (kind === 'transfer' && !destinationWalletId) || (kind === 'debt' && !debtId)}>{busy ? 'Saving…' : 'Save entry'}</button>
        </form>
      </section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">YOUR WALLETS</span><h2>Wallet balances</h2></div></div>
        {wallets.length ? wallets.map((item) => <div className="wallet-row" key={item.id}><div><b>{item.name}</b><small>{item.walletType || 'Wallet'}</small></div><strong>{money(Number(item.currentBalanceMinor || 0))}</strong></div>) : <p className="empty">No cached wallets yet. Connect and sync your account first.</p>}
      </section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Transactions</h2></div></div>
        {transactions.length ? transactions.slice(0,40).map((item) => <div className="transaction-row" key={item.id}><div><b>{item.description || item.transactionType}</b><small>{new Date(item.occurredAt || Date.now()).toLocaleString()} · {transactionWallet(item.walletId)}{item.pendingSync ? ' · Pending sync' : ''}</small></div><strong className={item.transactionType==='income'?'positive':item.transactionType==='expense'?'negative':''}>{item.transactionType==='income'?'+':item.transactionType==='expense'?'-':''}{money(Number(item.amountMinor || 0))}</strong></div>) : <p className="empty">Your local transaction list will appear here.</p>}
      </section>
      </>}
      {view === 'activity' && <section className="panel"><div className="section-heading"><div><span className="eyebrow">LEDGER</span><h2>All activity</h2></div><strong>{transactions.length}</strong></div><input className="search-input" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Search descriptions or wallets" aria-label="Search activity"/><div className="filter-row">{(['all','income','expense','transfer'] as const).map((filter) => <button type="button" key={filter} className={activityFilter===filter?'active':''} onClick={() => setActivityFilter(filter)}>{filter[0].toUpperCase()+filter.slice(1)}</button>)}</div>{filteredTransactions.length ? filteredTransactions.map((item) => <div className="transaction-row" key={item.id}><div><b>{item.description || item.transactionType}</b><small>{new Date(item.occurredAt || Date.now()).toLocaleString()} · {transactionWallet(item.walletId)}{item.pendingSync ? ' · Pending sync' : ''}</small></div><strong className={item.transactionType==='income'?'positive':item.transactionType==='expense'?'negative':''}>{item.transactionType==='income'?'+':item.transactionType==='expense'?'-':''}{money(Number(item.amountMinor || 0))}</strong></div>) : <p className="empty">No matching activity in this local snapshot.</p>}</section>}
      {view === 'insights' && <><section className="panel"><span className="eyebrow">THIS MONTH</span><h2>{new Date().toLocaleDateString('en', {month:'long',year:'numeric'})}</h2><div className="metric-grid"><div><small>Income</small><strong className="positive">{money(monthIncome)}</strong></div><div><small>Expenses</small><strong className="negative">{money(monthExpense)}</strong></div><div><small>Net cash flow</small><strong>{money(monthIncome-monthExpense)}</strong></div><div><small>Transactions</small><strong>{monthTransactions.length}</strong></div></div></section><section className="panel"><span className="eyebrow">SPENDING SNAPSHOT</span><h2>Where things stand</h2><div className="metric-line"><span>Wallet balance</span><b>{money(totalBalance)}</b></div><div className="metric-line"><span>Outstanding due</span><b>{money(openDebtTotal)}</b></div><div className="metric-line"><span>Average expense / entry</span><b>{money(monthTransactions.filter((item) => item.transactionType === 'expense').length ? monthExpense / monthTransactions.filter((item) => item.transactionType === 'expense').length : 0)}</b></div><p className="empty">Insights are calculated from the transactions currently stored on this device. Sync to refresh the snapshot.</p></section></>}
      {view === 'debts' && <section className="panel"><div className="section-heading"><div><span className="eyebrow">DUE & DEBT</span><h2>Outstanding balances</h2></div><strong>{money(openDebtTotal)}</strong></div>{debts.length ? debts.map((item) => {const principal=Number(item.principalMinor||0);const paid=Number(item.paidMinor||0);const remaining=Math.max(0,principal-paid);return <div className="debt-row" key={item.id}><div><b>{item.title||item.name||'Due'}</b><small>{paid>0?'Partially paid':'Unpaid'} · {money(paid)} paid</small><div className="debt-track"><span style={{width:`${principal>0?Math.min(100,paid/principal*100):0}%`}}/></div></div><strong>{money(remaining)}</strong></div>}) : <p className="empty">No outstanding debts in this local snapshot.</p>}<p className="empty">Debt creation and editing will be enabled after the local ledger operations are implemented.</p></section>}
      {view === 'fiscus' && <section className="panel fiscus-panel"><div className="section-heading"><div><span className="eyebrow">MONETRA INTELLIGENCE</span><h2>Fiscus AI</h2><p className="empty">Your personal financial thinking partner · online</p></div><button className="sync-button" type="button" onClick={() => void startFiscusChat()} disabled={!isSignedIn || fiscusLoading}>New chat</button></div>{!isSignedIn && <p className="empty">Connect to the internet and sign in to use Fiscus.</p>}{fiscusMessages.length===0 && <div className="fiscus-welcome"><b>What are we figuring out today?</b><p>Ask about spending patterns, monthly cash flow, wallet balances, or whether a purchase fits your finances.</p></div>}<div className="fiscus-messages">{fiscusMessages.map((item,index)=><div className={'fiscus-message '+item.role} key={index}><small>{item.role==='user'?'YOU':'FISCUS'}</small><p>{item.content}</p></div>)}{fiscusLoading && <p className="empty">Fiscus is thinking…</p>}</div>{fiscusError && <p className="error">{fiscusError}</p>}<form className="fiscus-composer" onSubmit={sendFiscusMessage}><textarea value={fiscusDraft} onChange={(event)=>setFiscusDraft(event.target.value)} placeholder="Ask Fiscus anything about your money…" rows={3} maxLength={3000} disabled={!isSignedIn || fiscusLoading}/><button className="primary" disabled={!isSignedIn || fiscusLoading || !fiscusDraft.trim()}>{fiscusLoading?'Thinking…':'Send message'}</button></form><p className="empty">Fiscus requires internet. It can analyze synced account data; unsynced offline entries are not included until they sync.</p></section>}
      {view === 'settings' && <section className="panel"><span className="eyebrow">DEVICE & ACCOUNT</span><h2>Settings</h2><div className="metric-line"><span>Workspace</span><b>{workspace?.name||'Personal'}</b></div><div className="metric-line"><span>Connection</span><b>{navigator.onLine?'Online':'Offline'}</b></div><div className="metric-line"><span>Local database</span><b>Encrypted SQLite</b></div><div className="metric-line"><span>Sync</span><b>{busy?'In progress':'Manual / reconnect'}</b></div><button className="primary settings-action" type="button" onClick={() => void refresh()} disabled={busy}>{busy?'Working…':'Sync now'}</button><p className="empty">Your six-digit device PIN protects local access. Fiscus AI is an online feature and is not available while offline.</p></section>}
      <footer>Encrypted local database · {navigator.onLine ? 'Online' : 'Offline'} · Fiscus AI requires internet</footer>
    </main>
  );
}
