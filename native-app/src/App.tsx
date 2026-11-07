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

const API_BASE = (import.meta.env.VITE_MONETRA_API_URL || 'https://monetra-4rax.vercel.app').replace(/\\/+$/, '');
type Wallet = { id: string; name: string; walletType?: string; currentBalanceMinor?: number; currency?: string; status?: string };
type Category = { id: string; name: string; categoryType: 'income' | 'expense' };
type Transaction = { id: string; transactionType: string; amountMinor: number; description?: string; occurredAt?: string; walletId?: string; pendingSync?: boolean };
type Debt = { id: string; title?: string; name?: string; principalMinor?: number; status?: string };
type Mode = 'checking' | 'sign-in' | 'prepare' | 'setup-pin' | 'unlock' | 'dashboard' | 'error';

function money(minor: number): string {
  return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format((minor || 0) / 100);
}
function asRows<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

export default function App() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [mode, setMode] = useState<Mode>('checking');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<CachedWorkspace | null>(null);
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
  const initialized = useRef(false);

  const wallets = useMemo(() => asRows<Wallet>(data?.wallets).filter((item) => item.status !== 'inactive'), [data]);
  const categories = useMemo(() => asRows<Category>(data?.categories), [data]);
  const transactions = useMemo(() => asRows<Transaction>(data?.transactions).slice().sort((a,b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))), [data]);
  const debts = useMemo(() => asRows<Debt>(data?.dueDebts).filter((item) => item.status !== 'settled' && item.status !== 'archived'), [data]);
  const totalBalance = wallets.reduce((sum, item) => sum + Number(item.currentBalanceMinor || 0), 0);

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
        const selected = (rows as CachedWorkspace[]).find((item) => item.type === 'personal') || (rows as CachedWorkspace[])[0];
        if (!selected?.id) throw new Error('No personal workspace is available for this account.');
        await syncNativeWorkspace(userId, selected.id);
        setWorkspace(selected);
        const hasPin = await hasNativeAppPin(userId);
        setMode(hasPin ? 'unlock' : 'setup-pin');
      } catch (cause) {
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
        await syncNativeWorkspace(ownerId, selected.id);
        await loadLocal(selected.id);
        setMessage('Synced with your Monetra account.');
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
      await loadLocal(workspace.id);
      setAmount(''); setDescription('');
      setMessage(navigator.onLine ? 'Saved locally. Syncing…' : 'Saved offline on this device.');
      if (navigator.onLine && isSignedIn) {
        configureSync();
        await syncNativeWorkspace(ownerId, workspace.id);
        await loadLocal(workspace.id);
        setMessage('Saved and synced.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this entry.');
    } finally { setBusy(false); }
  };

  if (mode === 'checking' || mode === 'prepare') {
    return <main className="screen center"><div className="brand-mark">M</div><div className="spinner" /><h1>{mode === 'prepare' ? 'Preparing your offline vault' : 'Opening Monetra'}</h1><p>Securing your local finance data…</p></main>;
  }
  if (mode === 'sign-in') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Welcome to Monetra</h1><p>Sign in once to download your finance workspace for offline use.</p><SignIn routing="hash" /></main>;
  }
  if (mode === 'setup-pin') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Protect your offline vault</h1><p>Create a six-digit PIN. You’ll need it to open your saved finance data when you’re offline.</p><form className="pin-form" onSubmit={createPin}><input aria-label="Six-digit PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\\D/g, '').slice(0,6))} placeholder="••••••" /><input aria-label="Confirm PIN" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\\D/g, '').slice(0,6))} placeholder="Confirm PIN" /><button disabled={busy || pin.length !== 6 || pinConfirm.length !== 6}>Enable offline lock</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'unlock') {
    return <main className="screen center"><div className="brand-mark">M</div><h1>Unlock Monetra</h1><p>{workspace?.name || 'Your saved workspace'} · Enter your device PIN to view local finance data.</p><form className="pin-form" onSubmit={unlock}><input aria-label="Six-digit PIN" autoFocus inputMode="numeric" maxLength={6} pattern="[0-9]{6}" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\\D/g, '').slice(0,6))} placeholder="••••••" /><button disabled={busy || pin.length !== 6}>{busy ? 'Unlocking…' : 'Unlock'}</button></form>{error && <p className="error">{error}</p>}</main>;
  }
  if (mode === 'sign-in') return <main className="screen center"><SignIn routing="hash" /></main>;
  if (mode === 'error') return <main className="screen center"><div className="brand-mark">M</div><h1>Monetra couldn’t open</h1><p>{error}</p>{isLoaded && !isSignedIn && navigator.onLine && <button onClick={() => setMode('sign-in')}>Sign in</button>}<button className="secondary" onClick={() => window.location.reload()}>Try again</button></main>;

  const transactionWallet = (id?: string) => wallets.find((item) => item.id === id)?.name || 'Wallet';
  return (
    <main className="app">
      <header className="topbar"><div className="brand"><div className="brand-mark small">M</div><div><b>Monetra</b><small>{workspace?.name || 'Personal'} space</small></div></div><button className="sync-button" onClick={() => void refresh()} disabled={busy}>{busy ? 'Working…' : navigator.onLine ? 'Sync now' : 'Offline'}</button></header>
      <section className="hero"><span className="eyebrow">TOTAL WALLET BALANCE</span><h1>{money(totalBalance)}</h1><p>{navigator.onLine ? 'Your local vault is ready to sync.' : 'Saved on this device · no internet required.'}</p></section>
      {message && <p className="notice">{message}</p>}{error && <p className="error notice">{error}</p>}
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
      <footer>Encrypted local database · {navigator.onLine ? 'Online' : 'Offline'} · Fiscus AI requires internet</footer>
    </main>
  );
}
