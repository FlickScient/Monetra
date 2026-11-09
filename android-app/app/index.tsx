import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet,
  Text, TextInput, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useAuth, useClerk, useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { apiRequest, Workspace } from '@/src/lib/api';
import { queueOperation, readPendingOperations, readSnapshot, readWorkspaceIndex, removePendingOperation, writeSnapshot, writeWorkspaceIndex } from '@/src/lib/offline';
import { theme } from '@/src/theme';
import { FiscusChat } from '@/src/components/FiscusChat';
import { MoneyTools } from '@/src/components/MoneyTools';

type Wallet = { id: string; name: string; walletType: string; currency: string; currentBalanceMinor: number; status: string; creditLimitMinor?: number; notes?: string | null };
type Category = { id: string; name: string; categoryType: 'income' | 'expense'; color: string };
type Transaction = { id: string; transactionType: 'income' | 'expense' | 'transfer'; walletId: string; destinationWalletId?: string | null; amountMinor: number; description: string; occurredAt: string; categoryId?: string | null; voidedAt?: string | null };
type Debt = { id: string; direction: 'receivable' | 'payable'; counterpartyName: string; principalMinor: number; dueDate: string | null; note?: string | null; status: string };
type DebtPayment = { id: string; dueDebtId: string; amountMinor: number; paidAt: string; note?: string | null };
type GoalAllocation = { id: string; goalId: string; walletId: string; amountMinor: number };
type Budget = { id: string; categoryId: string; monthStart: string; limitMinor: number; carryForward: boolean };
type Goal = { id: string; name: string; targetMinor: number; currency: string; targetDate: string | null; status: string; allocations: { walletId: string; amountMinor: number }[] };
type Snapshot = {
  workspace: { id: string; name: string; type: string };
  cursor: string;
  exportedAt: string;
  data: {
    wallets: Wallet[]; categories: Category[]; transactions: Transaction[];
    dueDebts: Debt[]; dueDebtPayments: DebtPayment[]; savingsGoals: Omit<Goal, 'allocations'>[];
    goalAllocations: GoalAllocation[]; monthlyBudgets: Budget[]; recurringTransactions: any[]; walletReconciliations: any[];
    financeAuditEvents: any[]; ledgerAccounts: any[]; ledgerEntries: any[];
  };
};
type ModuleKey = 'overview' | 'wallets' | 'transactions' | 'income' | 'reports' | 'radar' | 'debts' | 'savings' | 'tools' | 'fiscus' | 'settings';
const modules: { key: ModuleKey; label: string; short: string }[] = [
  { key: 'overview', label: 'Overview', short: 'Home' },
  { key: 'wallets', label: 'Wallets', short: 'Wallets' },
  { key: 'transactions', label: 'Transactions', short: 'Activity' },
  { key: 'income', label: 'Income & Expense', short: 'Cash flow' },
  { key: 'reports', label: 'Reports', short: 'Reports' },
  { key: 'radar', label: 'Financial Radar', short: 'Radar' },
  { key: 'debts', label: 'Due & Debt', short: 'Due & Debt' },
  { key: 'savings', label: 'Savings Goals', short: 'Savings' },
  { key: 'tools', label: 'Money Tools', short: 'Tools' },
  { key: 'fiscus', label: 'Fiscus A.I.', short: 'Fiscus A.I.' },
  { key: 'settings', label: 'Settings', short: 'Settings' },
];
const money = (minor: number, currency = 'BDT') => new Intl.NumberFormat('en-BD', {
  style: 'currency', currency, maximumFractionDigits: 2,
}).format((Number(minor) || 0) / 100);
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.floor(Math.random() * 16);
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
});
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric' });
};

function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}
function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={styles.sectionHead}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}</View>{action}</View>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <Panel><Text style={styles.itemTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></Panel>;
}
function RowItem({ title, subtitle, amount, positive }: { title: string; subtitle: string; amount?: string; positive?: boolean }) {
  return <View style={styles.itemRow}><View style={styles.itemIcon}><Text style={styles.itemIconText}>{title.slice(0, 1).toUpperCase()}</Text></View><View style={styles.itemCopy}><Text numberOfLines={1} style={styles.itemTitle}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>{amount ? <Text style={[styles.itemAmount, positive ? styles.positive : null]}>{amount}</Text> : null}</View>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { isLoaded: isAuthLoaded, isSignedIn, getToken } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const { signOut } = useClerk();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [active, setActive] = useState<ModuleKey>('overview');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [authWaitExpired, setAuthWaitExpired] = useState(false);
  const [authRetryKey, setAuthRetryKey] = useState(0);
  const selectedWorkspaceId = useRef<string | null>(null);
  const initializedUserId = useRef<string | null>(null);
  const [modal, setModal] = useState(false);
  const [transactionType, setTransactionType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [walletId, setWalletId] = useState('');
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [editingTransactionOccurredAt, setEditingTransactionOccurredAt] = useState<string | null>(null);
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all'|'income'|'expense'|'transfer'>('all');
  const [reportMonth, setReportMonth] = useState(() => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7));
  const [walletModal, setWalletModal] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('');
  const [walletType, setWalletType] = useState('cash');
  const [walletOpeningBalance, setWalletOpeningBalance] = useState('0');
  const [walletCreditLimit, setWalletCreditLimit] = useState('0');
  const [walletNotes, setWalletNotes] = useState('');
  const [debtModal, setDebtModal] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [debtDirection, setDebtDirection] = useState<'receivable' | 'payable'>('payable');
  const [debtName, setDebtName] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtNote, setDebtNote] = useState('');
  const [paymentDebtId, setPaymentDebtId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [goalModal, setGoalModal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [allocationGoalId, setAllocationGoalId] = useState<string | null>(null);
  const [allocationWalletId, setAllocationWalletId] = useState('');
  const [allocationAmount, setAllocationAmount] = useState('');
  const [allocationAction, setAllocationAction] = useState<'allocate' | 'release'>('allocate');

  const getSessionToken = useCallback(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => getToken()),
        new Promise<null>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Secure sign-in is taking too long. Please retry or sign in again.')), 12000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [getToken]);

  useEffect(() => {
    if (isAuthLoaded && isUserLoaded) {
      setAuthWaitExpired(false);
      return;
    }
    const timer = setTimeout(() => setAuthWaitExpired(true), 15000);
    return () => clearTimeout(timer);
  }, [isAuthLoaded, isUserLoaded, authRetryKey]);

  const loadWorkspaceList = useCallback(async () => {
    let rows: Workspace[];
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Your sign-in session has expired.');
      // A cache failure must never turn a successful online response into a failed login.
      rows = await apiRequest<Workspace[]>('/api/workspaces', token);
      setOffline(false);
      try {
        await writeWorkspaceIndex(rows);
      } catch (cacheError) {
        console.warn('MONETRA_OFFLINE_CACHE_UNAVAILABLE: workspace index', cacheError);
        setNotice('Connected to Monetra. Encrypted offline cache is unavailable on this device.');
      }
    } catch (networkError) {
      const status = (networkError as { status?: number } | null)?.status;
      if (typeof status === 'number' && status < 500) throw networkError;
      try {
        rows = await readWorkspaceIndex<Workspace>();
      } catch (cacheError) {
        console.warn('MONETRA_OFFLINE_CACHE_READ_FAILED: workspace index', cacheError);
        rows = [];
      }
      if (!rows.length) throw networkError;
      setOffline(true);
    }
    setWorkspaces(rows);
    const chosen = rows.find(row => row.id === selectedWorkspaceId.current) ?? rows.find(row => row.type === 'personal') ?? rows[0] ?? null;
    selectedWorkspaceId.current = chosen?.id ?? null;
    setSelected(chosen);
    return chosen;
  }, [getSessionToken]);

  const loadWorkspace = useCallback(async (workspace: Workspace, silent = false) => {
    if (!silent) setSyncing(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Your sign-in session has expired.');
      let pending: Awaited<ReturnType<typeof readPendingOperations>> = [];
      try {
        pending = await readPendingOperations(workspace.id);
      } catch (cacheError) {
        console.warn('MONETRA_OFFLINE_QUEUE_UNAVAILABLE:', cacheError);
      }
      if (pending.length) {
        const supported = pending.filter(item => item.operationType === 'transaction.create');
        if (supported.length) {
          const result = await apiRequest<{ results: { operationId: string; ok: boolean }[] }>('/api/sync/push', token, {
            method: 'POST', workspaceId: workspace.id,
            body: { operations: supported.map(item => ({ operationId: item.operationId, type: item.operationType, payload: JSON.parse(item.payload) })) },
          });
          for (const item of result.results) {
            if (item.ok) {
              try { await removePendingOperation(item.operationId); }
              catch (cacheError) { console.warn('MONETRA_OFFLINE_QUEUE_CLEANUP_FAILED:', cacheError); }
            }
          }
        }
      }
      const fresh = await apiRequest<Snapshot>('/api/sync/bootstrap', token, { workspaceId: workspace.id });
      // Render authoritative server data first; encrypted local caching is best-effort.
      setSnapshot(fresh);
      setOffline(false);
      try {
        await writeSnapshot(workspace.id, fresh);
      } catch (cacheError) {
        console.warn('MONETRA_OFFLINE_CACHE_UNAVAILABLE: snapshot', cacheError);
        setNotice('Connected to Monetra. Your data loaded, but encrypted offline caching is unavailable on this device.');
      }
      if (pending.length) setNotice('Workspace synced. Pending changes were submitted with their original operation IDs.');
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (typeof status === 'number' && status < 500) throw error;
      let cached: Snapshot | null = null;
      try { cached = await readSnapshot<Snapshot>(workspace.id); }
      catch (cacheError) { console.warn('MONETRA_OFFLINE_CACHE_READ_FAILED: snapshot', cacheError); }
      if (cached) {
        setSnapshot(cached);
        setOffline(true);
        setNotice('Offline mode · showing your last saved workspace snapshot.');
      } else {
        throw error;
      }
    } finally {
      setSyncing(false);
      setRefreshing(false);
    }
  }, [getSessionToken]);

  const initialize = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const chosen = await loadWorkspaceList();
      if (chosen) await loadWorkspace(chosen);
      else throw new Error('No finance workspace is available for this account.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open your finance workspace.';
      setNotice(message);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [loadWorkspaceList, loadWorkspace]);

  useEffect(() => {
    if (!isAuthLoaded || !isUserLoaded) return;
    if (!isSignedIn) {
      initializedUserId.current = null;
      router.replace('/sign-in');
      return;
    }
    if (!user?.id) return;
    if (initializedUserId.current === user.id) return;
    initializedUserId.current = user.id;
    void initialize();
  }, [isAuthLoaded, isUserLoaded, isSignedIn, user?.id, initialize, router]);

  const data = snapshot?.data;
  const wallets = data?.wallets ?? [];
  const categories = data?.categories ?? [];
  const transactions = (data?.transactions ?? []).filter(row => !row.voidedAt).sort((a,b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const debts = useMemo(() => (data?.dueDebts ?? []).map(debt => {
    const payments = (data?.dueDebtPayments ?? []).filter(payment => payment.dueDebtId === debt.id);
    const paidMinor = payments.reduce((sum, payment) => sum + Number(payment.amountMinor), 0);
    return { ...debt, paidMinor, outstandingMinor: Math.max(0, Number(debt.principalMinor) - paidMinor) };
  }), [data]);
  const goals = useMemo(() => (data?.savingsGoals ?? []).map(goal => ({
    ...goal,
    allocations: (data?.goalAllocations ?? []).filter(allocation => allocation.goalId === goal.id),
  })), [data]);
  const filteredTransactions = transactions.filter(tx => {
    const query = transactionSearch.trim().toLowerCase();
    const walletName = wallets.find(wallet=>wallet.id===tx.walletId)?.name ?? '';
    const categoryName = categories.find(category=>category.id===tx.categoryId)?.name ?? '';
    const matchesQuery = !query || [tx.description,walletName,categoryName,String(Number(tx.amountMinor)/100)].some(value=>value.toLowerCase().includes(query));
    return matchesQuery && (transactionFilter==='all' || tx.transactionType===transactionFilter);
  });
  const reportTransactions = transactions.filter(tx => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).format(new Date(tx.occurredAt)).slice(0,7)===reportMonth);
  const reportIncome = reportTransactions.filter(tx=>tx.transactionType==='income').reduce((sum,tx)=>sum+Number(tx.amountMinor),0);
  const reportExpense = reportTransactions.filter(tx=>tx.transactionType==='expense').reduce((sum,tx)=>sum+Number(tx.amountMinor),0);

  const assets = wallets.filter(w => w.walletType !== 'credit_card').reduce((sum,w) => sum + Number(w.currentBalanceMinor), 0);
  const liabilities = wallets.filter(w => w.walletType === 'credit_card').reduce((sum,w) => sum + Number(w.currentBalanceMinor), 0);
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0,7);
  const thisMonth = transactions.filter(t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).format(new Date(t.occurredAt)).slice(0,7) === monthKey);
  const income = thisMonth.filter(t => t.transactionType === 'income').reduce((s,t) => s + Number(t.amountMinor), 0);
  const expense = thisMonth.filter(t => t.transactionType === 'expense').reduce((s,t) => s + Number(t.amountMinor), 0);

  async function refresh() {
    setRefreshing(true);
    try {
      const chosen = selected ?? await loadWorkspaceList();
      if (chosen) await loadWorkspace(chosen);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Refresh failed.'); setRefreshing(false); }
  }

  async function saveTransaction() {
    if (!selected || !walletId || (transactionType === 'transfer' && (!destinationWalletId || destinationWalletId === walletId)) || !description.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setNotice('Choose a wallet and enter a valid amount and description.');
      return;
    }
    const payload = {
      walletId, transactionType, ...(transactionType === 'transfer' ? { destinationWalletId } : { categoryId: categoryId || null }), amountMinor: Math.round(Number(amount) * 100),
      description: description.trim(), occurredAt: editingTransactionOccurredAt ?? new Date().toISOString(),
    };
    const operationId = uuid();
    setSaving(true);
    try {
      let token: string | null = null;
      try { token = await getSessionToken(); } catch { /* Offline creation can still be queued securely. */ }
      if (editingTransactionId) {
        if (!token) throw new Error('Editing an existing transaction requires an internet connection. Your saved record was not changed.');
        await apiRequest(`/api/transactions/${editingTransactionId}`, token, {
          method: 'PATCH', workspaceId: selected.id, body: payload,
        });
        await loadWorkspace(selected, true);
        setNotice('Transaction updated.');
      } else {
        const saveLocally = async () => {
          await queueOperation(selected.id, operationId, 'transaction.create', payload);
          const current = await readSnapshot<Snapshot>(selected.id);
          if (current) {
            const wallet = current.data.wallets.find(row => row.id === walletId);
            if (wallet) {
              const delta = transactionType === 'income' ? payload.amountMinor : -payload.amountMinor;
              wallet.currentBalanceMinor += wallet.walletType === 'credit_card' ? -delta : delta;
            }
            current.data.transactions.push({ id: operationId, ...payload, voidedAt: null } as Transaction);
            await writeSnapshot(selected.id, current);
            setSnapshot(current);
          }
          setOffline(true);
          setNotice('Saved on this device. It will sync when you reconnect.');
        };
        if (!token) {
          if (transactionType === 'transfer') throw new Error('Transfers need an internet connection. No transfer was recorded.');
          await saveLocally();
        } else {
          try {
            if (transactionType === 'transfer') {
              await apiRequest('/api/transfers', token, {
                method: 'POST', workspaceId: selected.id,
                body: { walletId, destinationWalletId, amountMinor: payload.amountMinor, description: payload.description, occurredAt: payload.occurredAt },
                headers: { 'idempotency-key': operationId },
              });
            } else {
              await apiRequest('/api/transactions', token, {
                method: 'POST', workspaceId: selected.id, body: payload,
                headers: { 'idempotency-key': operationId },
              });
            }
            await loadWorkspace(selected, true);
            setNotice('Transaction saved to your Monetra account.');
          } catch (error) {
            const apiError = error as Error & { status?: number };
            if (apiError.status || transactionType === 'transfer') throw error;
            await saveLocally();
          }
        }
      }
      setModal(false); setAmount(''); setDescription(''); setCategoryId(''); setDestinationWalletId(''); setEditingTransactionId(null); setEditingTransactionOccurredAt(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this transaction.');
    } finally { setSaving(false); }
  }

  function editTransaction(tx: Transaction) {
    setEditingTransactionId(tx.id);
    setEditingTransactionOccurredAt(tx.occurredAt);
    setTransactionType(tx.transactionType);
    setWalletId(tx.walletId);
    setDestinationWalletId(tx.destinationWalletId ?? '');
    setCategoryId(tx.categoryId ?? '');
    setAmount((Number(tx.amountMinor) / 100).toFixed(2));
    setDescription(tx.description);
    setModal(true);
  }

  function deleteTransaction(tx: Transaction) {
    Alert.alert('Delete transaction?', 'This will reverse the wallet balance and keep an audit record.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        try {
          const token = await getSessionToken();
          if (!token || !selected) throw new Error('Deleting a transaction requires an internet connection.');
          await apiRequest(`/api/transactions/${tx.id}`, token, { method: 'DELETE', workspaceId: selected.id });
          await loadWorkspace(selected, true);
          setNotice('Transaction deleted and wallet balance reversed.');
        } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete transaction.'); }
      })(); } },
    ]);
  }

  function openWalletEditor(wallet?: Wallet) {
    setEditingWalletId(wallet?.id ?? null);
    setWalletName(wallet?.name ?? '');
    setWalletType(wallet?.walletType ?? 'cash');
    setWalletOpeningBalance(wallet ? (Number(wallet.currentBalanceMinor) / 100).toFixed(2) : '0');
    setWalletCreditLimit(wallet ? (Number(wallet.creditLimitMinor ?? 0) / 100).toFixed(2) : '0');
    setWalletNotes(wallet?.notes ?? '');
    setWalletModal(true);
  }

  async function saveWallet() {
    if (!walletName.trim() || !selected || !Number.isFinite(Number(walletOpeningBalance)) || Number(walletOpeningBalance) < 0) {
      setNotice('Enter a wallet name and a valid opening balance.');
      return;
    }
    if (walletType === 'credit_card' && (!Number.isFinite(Number(walletCreditLimit)) || Number(walletCreditLimit) < 0)) {
      setNotice('Enter a valid credit limit.');
      return;
    }
    setSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('A connection is required to create or edit wallets.');
      const body = editingWalletId
        ? { name: walletName.trim(), notes: walletNotes || null, ...(walletType === 'credit_card' ? { creditLimitMinor: Math.round(Number(walletCreditLimit) * 100) } : {}) }
        : { name: walletName.trim(), walletType, currency: 'BDT', openingBalanceMinor: Math.round(Number(walletOpeningBalance) * 100), creditLimitMinor: walletType === 'credit_card' ? Math.round(Number(walletCreditLimit) * 100) : 0, notes: walletNotes || null };
      await apiRequest(editingWalletId ? `/api/wallets/${editingWalletId}` : '/api/wallets', token, {
        method: editingWalletId ? 'PATCH' : 'POST', workspaceId: selected.id, body,
      });
      await loadWorkspace(selected, true);
      setWalletModal(false);
      setNotice(editingWalletId ? 'Wallet updated.' : 'Wallet created.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save wallet.'); }
    finally { setSaving(false); }
  }

  function archiveWallet(wallet: Wallet) {
    Alert.alert('Archive wallet?', 'A wallet can only be archived after its balance is zero and it has no active savings allocations.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => { void (async () => {
        try {
          const token = await getSessionToken();
          if (!token || !selected) throw new Error('Archiving a wallet requires an internet connection.');
          await apiRequest(`/api/wallets/${wallet.id}`, token, { method: 'DELETE', workspaceId: selected.id });
          await loadWorkspace(selected, true);
          setNotice('Wallet archived.');
        } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not archive wallet.'); }
      })(); } },
    ]);
  }

  function openDebtEditor(debt: Debt) {
    setEditingDebtId(debt.id); setDebtDirection(debt.direction); setDebtName(debt.counterpartyName);
    setDebtAmount((Number(debt.principalMinor)/100).toFixed(2)); setDebtDueDate(debt.dueDate ?? '');
    setDebtNote(debt.note ?? ''); setDebtModal(true);
  }

  function archiveDebt(debt: Debt) {
    Alert.alert('Archive Due & Debt record?', 'This hides the record from active lists while preserving its payment history.', [
      {text:'Cancel',style:'cancel'},
      {text:'Archive',style:'destructive',onPress:()=>{void (async()=>{
        try { const token=await getSessionToken(); if(!token||!selected)throw new Error('Archiving this record requires an internet connection.');
          await apiRequest(`/api/due-debt/${debt.id}`,token,{method:'DELETE',workspaceId:selected.id});
          await loadWorkspace(selected,true); setNotice('Due & Debt record archived.');
        } catch(error) {setNotice(error instanceof Error?error.message:'Could not archive record.');}
      })();}},
    ]);
  }

  function openGoalEditor(goal: Goal) {
    setEditingGoalId(goal.id); setGoalName(goal.name); setGoalTarget((Number(goal.targetMinor)/100).toFixed(2));
    setGoalTargetDate(goal.targetDate ?? ''); setGoalModal(true);
  }

  function archiveGoal(goal: Goal) {
    Alert.alert('Archive savings goal?', 'Money allocated to this goal will be released back to its wallets. The history is preserved.', [
      {text:'Cancel',style:'cancel'},
      {text:'Archive',style:'destructive',onPress:()=>{void (async()=>{
        try { const token=await getSessionToken(); if(!token||!selected)throw new Error('Archiving a savings goal requires an internet connection.');
          await apiRequest(`/api/goals/${goal.id}`,token,{method:'DELETE',workspaceId:selected.id});
          await loadWorkspace(selected,true); setNotice('Savings goal archived and its allocations released.');
        } catch(error) {setNotice(error instanceof Error?error.message:'Could not archive savings goal.');}
      })();}},
    ]);
  }

  async function shareReportCsv() {
    const escapeCell = (value: unknown) => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const rows = [
      ['Date','Type','Description','Category','Wallet','Destination wallet','Amount BDT'],
      ...reportTransactions.map(tx=>[
        tx.occurredAt,
        tx.transactionType,
        tx.description,
        categories.find(category=>category.id===tx.categoryId)?.name ?? '',
        wallets.find(wallet=>wallet.id===tx.walletId)?.name ?? '',
        wallets.find(wallet=>wallet.id===tx.destinationWalletId)?.name ?? '',
        (Number(tx.amountMinor)/100).toFixed(2),
      ]),
    ];
    const csv = rows.map(row=>row.map(escapeCell).join(',')).join('\n');
    try { await Share.share({title:`Monetra ${reportMonth} CSV report`,message:csv}); }
    catch(error) { setNotice(error instanceof Error?error.message:'Could not open the share sheet.'); }
  }

  async function saveDebt() {
    if (!selected || !debtName.trim() || !Number.isFinite(Number(debtAmount)) || Number(debtAmount) <= 0) { setNotice('Enter a name and a valid principal amount.'); return; }
    if (debtDueDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(debtDueDate)) { setNotice('Due date must use YYYY-MM-DD format.'); return; }
    setSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Creating Due & Debt records requires an internet connection.');
      await apiRequest(editingDebtId ? `/api/due-debt/${editingDebtId}` : '/api/due-debt', token, { method:editingDebtId?'PATCH':'POST', workspaceId:selected.id, body:{direction:debtDirection,counterpartyName:debtName.trim(),principalMinor:Math.round(Number(debtAmount)*100),currency:'BDT',dueDate:debtDueDate||null,note:debtNote||null} });
      await loadWorkspace(selected,true);
      setDebtModal(false); setEditingDebtId(null); setDebtName(''); setDebtAmount(''); setDebtDueDate(''); setDebtNote(''); setNotice(editingDebtId?'Due & Debt record updated.':'Due & Debt record created.');
    } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not create record.'); }
    finally { setSaving(false); }
  }

  async function recordDebtPayment() {
    if (!selected || !paymentDebtId || !Number.isFinite(Number(paymentAmount)) || Number(paymentAmount)<=0) { setNotice('Enter a valid payment amount.'); return; }
    setSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Recording a debt payment requires an internet connection.');
      await apiRequest(`/api/due-debt/${paymentDebtId}/payments`,token,{method:'POST',workspaceId:selected.id,body:{amountMinor:Math.round(Number(paymentAmount)*100),note:paymentNote||null},headers:{'idempotency-key':uuid()}});
      await loadWorkspace(selected,true);
      setPaymentDebtId(null); setPaymentAmount(''); setPaymentNote(''); setNotice('Debt payment recorded.');
    } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not record payment.'); }
    finally { setSaving(false); }
  }

  async function saveGoal() {
    if (!selected || !goalName.trim() || !Number.isFinite(Number(goalTarget)) || Number(goalTarget)<=0) { setNotice('Enter a goal name and a valid target amount.'); return; }
    if (goalTargetDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(goalTargetDate)) { setNotice('Target date must use YYYY-MM-DD format.'); return; }
    setSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Creating savings goals requires an internet connection.');
      await apiRequest(editingGoalId ? `/api/goals/${editingGoalId}` : '/api/goals',token,{method:editingGoalId?'PATCH':'POST',workspaceId:selected.id,body:{name:goalName.trim(),targetMinor:Math.round(Number(goalTarget)*100),currency:'BDT',targetDate:goalTargetDate||null}});
      await loadWorkspace(selected,true);
      setGoalModal(false); setEditingGoalId(null); setGoalName(''); setGoalTarget(''); setGoalTargetDate(''); setNotice(editingGoalId?'Savings goal updated.':'Savings goal created.');
    } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not create savings goal.'); }
    finally { setSaving(false); }
  }

  async function saveGoalAllocation() {
    if (!selected || !allocationGoalId || !allocationWalletId || !Number.isFinite(Number(allocationAmount)) || Number(allocationAmount)<=0) { setNotice('Choose a wallet and enter a valid allocation amount.'); return; }
    setSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('Changing savings allocations requires an internet connection.');
      await apiRequest(`/api/goals/${allocationGoalId}/allocations`,token,{method:'POST',workspaceId:selected.id,body:{walletId:allocationWalletId,amountMinor:Math.round(Number(allocationAmount)*100),action:allocationAction}});
      await loadWorkspace(selected,true);
      setAllocationGoalId(null); setAllocationWalletId(''); setAllocationAmount(''); setNotice(allocationAction==='allocate'?'Money allocated to savings goal.':'Money released from savings goal.');
    } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not update savings allocation.'); }
    finally { setSaving(false); }
  }

  if (!isAuthLoaded || !isUserLoaded) {
    if (authWaitExpired) {
      return <View style={styles.center}>
        <Text style={styles.errorTitle}>Secure sign-in timed out</Text>
        <Text style={styles.errorMessage}>Monetra is waiting for Clerk to finish initializing. Check your connection, then retry. Your finance data has not been changed.</Text>
        <Pressable onPress={() => { setAuthWaitExpired(false); setAuthRetryKey(value => value + 1); }} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry sign-in</Text>
        </Pressable>
      </View>;
    }
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.green}/><Text style={styles.loadingText}>Preparing secure sign-in…</Text></View>;
  }
  if (!isSignedIn) return <View style={styles.center}><ActivityIndicator color={theme.colors.green}/><Text style={styles.loadingText}>Opening sign-in…</Text></View>;
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.green}/><Text style={styles.loadingText}>Preparing your Monetra workspace…</Text></View>;
  if (loadError && !snapshot) return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Couldn’t load your workspace</Text>
      <Text style={styles.errorMessage}>{loadError}</Text>
      <Pressable onPress={() => void initialize()} style={styles.retryButton}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
      <Pressable onPress={() => void signOut()} style={styles.signOutButton}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );

  const currentLabel = modules.find(item => item.key === active)?.label ?? 'Overview';
  const workspaceLabel = selected?.type === 'personal' ? 'Personal' : selected?.type === 'family' ? 'Family' : 'Business';
  const categoryList = transactionType === 'transfer' ? [] : categories.filter(c => c.categoryType === transactionType);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>monetra.</Text>
          <Text style={styles.headerMeta}>{workspaceLabel.toUpperCase()} WORKSPACE · {currentLabel.toUpperCase()}</Text>
        </View>
        <Pressable onPress={() => void signOut()} style={styles.avatar}><Text style={styles.avatarText}>{(user?.firstName?.[0] ?? 'M').toUpperCase()}</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaceTabs}>
        {workspaces.map(workspace => <Pressable key={workspace.id} onPress={() => { selectedWorkspaceId.current = workspace.id; setSelected(workspace); void loadWorkspace(workspace); }} style={[styles.workspaceTab, selected?.id === workspace.id && styles.workspaceTabActive]}><Text style={[styles.workspaceTabText, selected?.id === workspace.id && styles.workspaceTabTextActive]}>{workspace.type === 'personal' ? 'Personal' : workspace.type === 'family' ? 'Family' : 'Business'}</Text></Pressable>)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleTabs}>
        {modules.map(item => <Pressable key={item.key} onPress={() => setActive(item.key)} style={[styles.moduleTab, active === item.key && styles.moduleTabActive]}><Text style={[styles.moduleTabText, active === item.key && styles.moduleTabTextActive]}>{item.short}</Text></Pressable>)}
      </ScrollView>
      {notice ? <Pressable onPress={() => setNotice('')} style={styles.notice}><Text style={styles.noticeText}>{offline ? '● OFFLINE  ' : '●  '}{notice}</Text></Pressable> : null}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} refreshControl={<RefreshControl refreshing={refreshing || syncing} onRefresh={() => void refresh()} tintColor={theme.colors.green}/>}>
        {active === 'overview' && <>
          <View style={styles.intro}><Text style={styles.eyebrow}>YOUR MONEY, IN ONE PLACE</Text><Text style={styles.pageTitle}>Good to see you{user?.firstName ? ', ' + user.firstName : ''}.</Text><Text style={styles.muted}>Here’s what’s happening with your money.</Text></View>
          <Panel style={styles.hero}><Text style={styles.heroLabel}>TOTAL NET WORTH</Text><Text style={styles.heroValue}>{money(assets - liabilities)}</Text><Text style={styles.heroHint}>What you own, minus what you owe.</Text><View style={styles.heroStats}><View><Text style={styles.heroStatLabel}>TOTAL ASSETS</Text><Text style={styles.heroStatValue}>{money(assets)}</Text></View><View><Text style={styles.heroStatLabel}>LIABILITIES</Text><Text style={styles.heroStatValue}>{money(liabilities)}</Text></View></View></Panel>
          <View style={styles.metricGrid}><Panel style={styles.metric}><Text style={styles.metricLabel}>MONTHLY INCOME</Text><Text style={styles.metricValue}>{money(income)}</Text></Panel><Panel style={styles.metric}><Text style={styles.metricLabel}>MONTHLY EXPENSE</Text><Text style={styles.metricValue}>{money(expense)}</Text></Panel></View>
          <SectionTitle title="Your wallets" subtitle="Balances across this workspace" action={<Pressable onPress={() => setActive('wallets')}><Text style={styles.link}>View all</Text></Pressable>}/>
          {wallets.slice(0,4).map(wallet => <RowItem key={wallet.id} title={wallet.name} subtitle={wallet.walletType.replace('_',' ').toUpperCase()} amount={money(wallet.currentBalanceMinor,wallet.currency)}/>)}
          {!wallets.length && <Empty title="No wallets yet" detail="Create a wallet from the Wallets module to start tracking your money."/>}
          <SectionTitle title="Recent activity" subtitle="Your latest recorded transactions" action={<Pressable onPress={() => setActive('transactions')}><Text style={styles.link}>See all</Text></Pressable>}/>
          {transactions.slice(0,5).map(tx => <RowItem key={tx.id} title={tx.description} subtitle={dateLabel(tx.occurredAt)+' · '+tx.transactionType.toUpperCase()} amount={(tx.transactionType === 'income' ? '+' : '−')+money(tx.amountMinor)} positive={tx.transactionType === 'income'}/>)}
          {!transactions.length && <Empty title="No activity yet" detail="Your transactions will appear here once added."/>}
        </>}
        {active === 'wallets' && <>
          <SectionTitle title="Wallets" subtitle="Cash, mobile banking, bank accounts and cards" action={<Pressable style={styles.smallButton} onPress={() => openWalletEditor()}><Text style={styles.smallButtonText}>+ Add wallet</Text></Pressable>}/>
          <Panel><Text style={styles.heroLabel}>TOTAL AVAILABLE BALANCE</Text><Text style={styles.panelBig}>{money(assets-liabilities)}</Text><Text style={styles.muted}>{wallets.length} wallet(s) in {workspaceLabel}</Text></Panel>
          {wallets.map(wallet => <Panel key={wallet.id}>
            <RowItem title={wallet.name} subtitle={wallet.walletType.replace('_',' ').toUpperCase()+' · '+wallet.status} amount={money(wallet.currentBalanceMinor,wallet.currency)}/>
            <View style={{flexDirection:'row',gap:9,marginTop:8}}>
              <Pressable style={styles.secondaryButton} onPress={() => openWalletEditor(wallet)}><Text style={styles.secondaryButtonText}>Edit</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => archiveWallet(wallet)}><Text style={styles.secondaryButtonText}>Archive</Text></Pressable>
            </View>
          </Panel>)}
          {!wallets.length && <Empty title="No wallets found" detail="Your existing website wallets should appear here after signing in with the same Monetra account."/>}
        </>}
        {active === 'transactions' && <>
          <SectionTitle title="Transactions" subtitle="Search, filter, edit and manage your records" action={<Pressable style={styles.smallButton} onPress={() => {setEditingTransactionId(null);setEditingTransactionOccurredAt(null);setTransactionType('expense');setDestinationWalletId('');setModal(true);}}><Text style={styles.smallButtonText}>+ Add</Text></Pressable>}/>
          <TextInput value={transactionSearch} onChangeText={setTransactionSearch} placeholder="Search description, wallet, category or amount…" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight:42}}>
            {(['all','income','expense','transfer'] as const).map(value=><Pressable key={value} onPress={()=>setTransactionFilter(value)} style={[styles.choice,transactionFilter===value&&styles.choiceActive]}><Text style={[styles.choiceText,transactionFilter===value&&styles.choiceTextActive]}>{value==='all'?'All':value[0].toUpperCase()+value.slice(1)}</Text></Pressable>)}
          </ScrollView>
          {filteredTransactions.slice(0,100).map(tx => <Panel key={tx.id}>
            <RowItem title={tx.description} subtitle={dateLabel(tx.occurredAt)+' · '+tx.transactionType.toUpperCase()} amount={(tx.transactionType==='income'?'+':tx.transactionType==='transfer'?'↔ ':'−')+money(tx.amountMinor)} positive={tx.transactionType==='income'}/>
            <View style={{flexDirection:'row',gap:9,marginTop:7}}>
              <Pressable style={styles.secondaryButton} onPress={() => editTransaction(tx)}><Text style={styles.secondaryButtonText}>Edit</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => deleteTransaction(tx)}><Text style={styles.secondaryButtonText}>Delete</Text></Pressable>
            </View>
          </Panel>)}
          {!filteredTransactions.length && <Empty title="No matching transactions" detail="Try another search or transaction type."/>}
        </>}
        {active === 'income' && <>
          <SectionTitle title="Income & Expense" subtitle="Monthly cash flow · Bangladesh time"/>
          <Text style={styles.fieldLabel}>REPORT MONTH (YYYY-MM)</Text>
          <TextInput value={reportMonth} onChangeText={value=>{const digits=value.replace(/\D/g,'').slice(0,6);setReportMonth(digits.length>4?digits.slice(0,4)+'-'+digits.slice(4):digits);}} maxLength={7} placeholder="2026-11" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <View style={styles.metricGrid}><Panel style={styles.metric}><Text style={styles.metricLabel}>INCOME</Text><Text style={styles.metricValue}>{money(reportIncome)}</Text></Panel><Panel style={styles.metric}><Text style={styles.metricLabel}>EXPENSE</Text><Text style={styles.metricValue}>{money(reportExpense)}</Text></Panel></View>
          <Panel><Text style={styles.metricLabel}>NET CASH FLOW</Text><Text style={[styles.panelBig, reportIncome-reportExpense>=0?styles.positive:styles.negative]}>{money(reportIncome-reportExpense)}</Text><Text style={styles.muted}>Transfers and opening balances are not included. Period: {reportMonth}.</Text></Panel>
          {reportTransactions.filter(tx=>tx.transactionType!=='transfer').slice(0,100).map(tx => <RowItem key={tx.id} title={tx.description} subtitle={dateLabel(tx.occurredAt)} amount={(tx.transactionType==='income'?'+':'−')+money(tx.amountMinor)} positive={tx.transactionType==='income'}/> )}
          {!reportTransactions.length&&<Empty title="No activity for this month" detail="Choose another month or add a transaction."/>}
        </>}
        {active === 'reports' && <>
          <SectionTitle title="Reports" subtitle="Monthly summary and category breakdown" action={<Pressable style={styles.smallButton} onPress={()=>void shareReportCsv()}><Text style={styles.smallButtonText}>Share CSV</Text></Pressable>}/>
          <Text style={styles.fieldLabel}>REPORT MONTH (YYYY-MM)</Text>
          <TextInput value={reportMonth} onChangeText={value=>{const digits=value.replace(/\D/g,'').slice(0,6);setReportMonth(digits.length>4?digits.slice(0,4)+'-'+digits.slice(4):digits);}} maxLength={7} placeholder="2026-11" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <View style={styles.metricGrid}><Panel style={styles.metric}><Text style={styles.metricLabel}>INCOME</Text><Text style={styles.metricValue}>{money(reportIncome)}</Text></Panel><Panel style={styles.metric}><Text style={styles.metricLabel}>EXPENSE</Text><Text style={styles.metricValue}>{money(reportExpense)}</Text></Panel></View>
          <Panel><Text style={styles.itemTitle}>Spending by category</Text>{categories.filter(c=>c.categoryType==='expense').map(category=>{const total=reportTransactions.filter(t=>t.transactionType==='expense'&&t.categoryId===category.id).reduce((sum,t)=>sum+Number(t.amountMinor),0);return total>0?<View key={category.id} style={styles.reportRow}><Text style={styles.muted}>{category.name}</Text><Text style={styles.itemAmount}>{money(total)}</Text></View>:null;})}</Panel>
          <Text style={styles.muted}>CSV share includes this month’s transaction date, type, description, category, source wallet, destination wallet and amount.</Text>
        </>}
        {active === 'radar' && <>
          <SectionTitle title="Financial Radar" subtitle="Signals calculated from your synced workspace"/>
          <View style={styles.metricGrid}><Panel style={styles.metric}><Text style={styles.metricLabel}>WALLET COUNT</Text><Text style={styles.metricValue}>{wallets.length}</Text></Panel><Panel style={styles.metric}><Text style={styles.metricLabel}>OPEN DEBTS</Text><Text style={styles.metricValue}>{debts.filter(d=>d.outstandingMinor>0).length}</Text></Panel></View>
          <Panel><Text style={styles.itemTitle}>Cash-flow signal</Text><Text style={styles.muted}>{income>=expense?'Your recorded income is currently above expenses for this month.':'Your recorded expenses are currently above income for this month.'}</Text><Text style={styles.panelBig}>{money(income-expense)}</Text></Panel>
          <Panel><Text style={styles.itemTitle}>Wallet health</Text>{wallets.filter(w=>w.currentBalanceMinor<0).map(w=><RowItem key={w.id} title={w.name} subtitle="Negative balance · review spending" amount={money(w.currentBalanceMinor)}/>)}{!wallets.some(w=>w.currentBalanceMinor<0)&&<Text style={styles.muted}>No negative wallet balances in this snapshot.</Text>}</Panel>
        </>}
        {active === 'debts' && <>
          <SectionTitle title="Due & Debt" subtitle="Receivables and payables · separate from wallet assets" action={<Pressable style={styles.smallButton} onPress={() => {setEditingDebtId(null);setDebtName('');setDebtAmount('');setDebtDueDate('');setDebtNote('');setDebtDirection('payable');setDebtModal(true);}}><Text style={styles.smallButtonText}>+ Add record</Text></Pressable>}/>
          <View style={styles.metricGrid}><Panel style={styles.metric}><Text style={styles.metricLabel}>TO RECEIVE</Text><Text style={styles.metricValue}>{money(debts.filter(d=>d.direction==='receivable').reduce((s,d)=>s+d.outstandingMinor,0))}</Text></Panel><Panel style={styles.metric}><Text style={styles.metricLabel}>TO PAY</Text><Text style={styles.metricValue}>{money(debts.filter(d=>d.direction==='payable').reduce((s,d)=>s+d.outstandingMinor,0))}</Text></Panel></View>
          {debts.filter(debt=>debt.status!=='archived').map(debt=><Panel key={debt.id}>
            <RowItem title={debt.counterpartyName} subtitle={(debt.direction==='receivable'?'They owe you':'You owe')+' · Due '+(debt.dueDate||'not set')} amount={money(debt.outstandingMinor)} positive={debt.direction==='receivable'}/>
            <Text style={styles.muted}>Principal {money(debt.principalMinor)} · Paid {money(Number(debt.principalMinor)-Number(debt.outstandingMinor))}</Text>
            <View style={{flexDirection:'row',gap:8,marginTop:8}}>
              {debt.outstandingMinor>0 ? <Pressable style={styles.smallButton} onPress={()=>{setPaymentDebtId(debt.id);setPaymentAmount((debt.outstandingMinor/100).toFixed(2));setPaymentNote('');}}><Text style={styles.smallButtonText}>Record payment</Text></Pressable> : null}
              <Pressable style={styles.secondaryButton} onPress={()=>openDebtEditor(debt)}><Text style={styles.secondaryButtonText}>Edit</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={()=>archiveDebt(debt)}><Text style={styles.secondaryButtonText}>Archive</Text></Pressable>
            </View>
          </Panel>)}
          {!debts.some(debt=>debt.status!=='archived')&&<Empty title="No due or debt records" detail="Create a receivable or payable to track outstanding principal and partial payments."/>}
        </>}
        {active === 'savings' && <>
          <SectionTitle title="Savings Goals" subtitle="Targets and wallet allocations" action={<Pressable style={styles.smallButton} onPress={() => {setEditingGoalId(null);setGoalName('');setGoalTarget('');setGoalTargetDate('');setGoalModal(true);}}><Text style={styles.smallButtonText}>+ New goal</Text></Pressable>}/>
          {goals.filter(goal=>goal.status!=='archived').map(goal=>{const saved=goal.allocations.reduce((sum,a)=>sum+Number(a.amountMinor),0);const percent=goal.targetMinor>0?Math.min(100,saved/goal.targetMinor*100):0;return <Panel key={goal.id}><Text style={styles.itemTitle}>{goal.name}</Text><Text style={styles.panelBig}>{money(saved)} <Text style={styles.muted}>/ {money(goal.targetMinor)}</Text></Text><View style={styles.progress}><View style={[styles.progressFill,{width:`${percent}%`}]}/></View><Text style={styles.muted}>{Math.round(percent)}% funded · {goal.targetDate?'Target '+goal.targetDate:'No target date'}</Text>
            {goal.allocations.map(allocation=>{const wallet=wallets.find(w=>w.id===allocation.walletId);return <RowItem key={allocation.id} title={wallet?.name??'Wallet'} subtitle="Allocated" amount={money(allocation.amountMinor)}/>;})}
            <View style={{flexDirection:'row',gap:8,marginTop:8}}>
              <Pressable style={styles.smallButton} onPress={()=>{setAllocationGoalId(goal.id);setAllocationAction('allocate');setAllocationWalletId('');setAllocationAmount('');}}><Text style={styles.smallButtonText}>Allocate</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={()=>{setAllocationGoalId(goal.id);setAllocationAction('release');setAllocationWalletId('');setAllocationAmount('');}}><Text style={styles.secondaryButtonText}>Release</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={()=>openGoalEditor(goal)}><Text style={styles.secondaryButtonText}>Edit</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={()=>archiveGoal(goal)}><Text style={styles.secondaryButtonText}>Archive</Text></Pressable>
            </View>
          </Panel>;})}
          {!goals.some(goal=>goal.status!=='archived')&&<Empty title="No savings goals yet" detail="Create your first goal to track money set aside across wallets."/>}
        </>}
        {active === 'tools' && selected && <MoneyTools
          workspaceId={selected.id}
          wallets={wallets}
          categories={categories}
          budgets={data?.monthlyBudgets ?? []}
          recurring={data?.recurringTransactions ?? []}
          reconciliations={data?.walletReconciliations ?? []}
          transactions={transactions}
          getToken={getSessionToken}
          onChanged={() => void loadWorkspace(selected, true)}
        />}
        {active === 'fiscus' && selected && <FiscusChat workspaceId={selected.id} getToken={getSessionToken}/ >}
        {active === 'settings' && <>
          <SectionTitle title="Settings" subtitle="Account, device storage and synchronization"/>
          <Panel><Text style={styles.itemTitle}>Signed in</Text><Text style={styles.muted}>{user?.primaryEmailAddress?.emailAddress??'Monetra account'}</Text></Panel>
          <Panel><Text style={styles.itemTitle}>Offline workspace</Text><Text style={styles.muted}>{offline?'Offline snapshot active':'Local SQLite cache enabled'} · Last snapshot {snapshot?.exportedAt?dateLabel(snapshot.exportedAt):'not available'}</Text><Text style={styles.muted}>Your finance data is cached on this device after a successful sync.</Text></Panel>
          <Pressable style={styles.primaryButton} onPress={() => void refresh()}><Text style={styles.primaryButtonText}>{syncing?'Syncing…':'Sync now'}</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void signOut()}><Text style={styles.secondaryButtonText}>Sign out</Text></Pressable>
        </>}
        <Text style={styles.footer}>MONETRA · PRIVATE FINANCE · {offline?'OFFLINE':'CONNECTED'}</Text>
      </ScrollView>
      <View style={styles.bottomBar}>
        {modules.slice(0,5).map(item=><Pressable key={item.key} onPress={()=>setActive(item.key)} style={styles.bottomItem}><View style={[styles.bottomDot,active===item.key&&styles.bottomDotActive]}/><Text style={[styles.bottomText,active===item.key&&styles.bottomTextActive]}>{item.short}</Text></Pressable>)}
        <Pressable onPress={()=>setActive('settings')} style={styles.bottomItem}><View style={[styles.bottomDot,active==='settings'&&styles.bottomDotActive]}/><Text style={[styles.bottomText,active==='settings'&&styles.bottomTextActive]}>More</Text></Pressable>
      </View>
      <Pressable style={styles.fab} onPress={()=>{setEditingTransactionId(null);setEditingTransactionOccurredAt(null);setTransactionType('expense');setDestinationWalletId('');setModal(true);}}><Text style={styles.fabText}>＋</Text></Pressable>
      <Modal visible={modal} transparent animationType="slide" onRequestClose={()=>setModal(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingTransactionId ? 'Edit transaction' : 'New transaction'}</Text><Pressable onPress={()=>{setModal(false);setEditingTransactionId(null);setEditingTransactionOccurredAt(null);}}><Text style={styles.close}>✕</Text></Pressable></View>
          <View style={styles.typeSwitch}>
            <Pressable onPress={()=>setTransactionType('expense')} style={[styles.typeButton,transactionType==='expense'&&styles.typeActive]}><Text style={[styles.typeText,transactionType==='expense'&&styles.typeTextActive]}>Expense</Text></Pressable>
            <Pressable onPress={()=>setTransactionType('income')} style={[styles.typeButton,transactionType==='income'&&styles.typeActive]}><Text style={[styles.typeText,transactionType==='income'&&styles.typeTextActive]}>Income</Text></Pressable>
            <Pressable onPress={()=>setTransactionType('transfer')} style={[styles.typeButton,transactionType==='transfer'&&styles.typeActive]}><Text style={[styles.typeText,transactionType==='transfer'&&styles.typeTextActive]}>Transfer</Text></Pressable>
          </View>
          <Text style={styles.fieldLabel}>Amount (৳)</Text><TextInput keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>Description</Text><TextInput value={description} onChangeText={setDescription} placeholder="What was this for?" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>{transactionType==='transfer'?'From wallet':'Wallet'}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{wallets.filter(w=>w.status==='active'&&(transactionType!=='transfer'||w.walletType!=='credit_card')).map(w=><Pressable key={w.id} onPress={()=>setWalletId(w.id)} style={[styles.choice, walletId===w.id&&styles.choiceActive]}><Text style={[styles.choiceText,walletId===w.id&&styles.choiceTextActive]}>{w.name}</Text></Pressable>)}</ScrollView>
          {transactionType==='transfer'?<>
            <Text style={styles.fieldLabel}>TO WALLET</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{wallets.filter(w=>w.status==='active'&&w.id!==walletId).map(w=><Pressable key={w.id} onPress={()=>setDestinationWalletId(w.id)} style={[styles.choice,destinationWalletId===w.id&&styles.choiceActive]}><Text style={[styles.choiceText,destinationWalletId===w.id&&styles.choiceTextActive]}>{w.name}</Text></Pressable>)}</ScrollView>
          </>:<>
            <Text style={styles.fieldLabel}>Category</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{categoryList.map(c=><Pressable key={c.id} onPress={()=>setCategoryId(c.id)} style={[styles.choice,categoryId===c.id&&styles.choiceActive]}><Text style={[styles.choiceText,categoryId===c.id&&styles.choiceTextActive]}>{c.name}</Text></Pressable>)}</ScrollView>
          </>}
          <Pressable disabled={saving} onPress={()=>void saveTransaction()} style={[styles.primaryButton,{marginTop:20}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':editingTransactionId?'Update transaction':'Save transaction'}</Text></Pressable>
          {offline?<Text style={styles.muted}>Offline entries are queued locally and sync when you reconnect.</Text>:null}
        </View></View>
      </Modal>
      <Modal visible={walletModal} transparent animationType="slide" onRequestClose={() => setWalletModal(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingWalletId ? 'Edit wallet' : 'New wallet'}</Text><Pressable onPress={() => setWalletModal(false)}><Text style={styles.close}>✕</Text></Pressable></View>
          <Text style={styles.fieldLabel}>WALLET NAME</Text>
          <TextInput value={walletName} onChangeText={setWalletName} placeholder="e.g. Main bKash" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          {!editingWalletId ? <>
            <Text style={styles.fieldLabel}>WALLET TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {['cash','bkash','nagad','rocket','bank','savings','debit_card','credit_card','custom'].map(type=><Pressable key={type} onPress={()=>setWalletType(type)} style={[styles.choice,walletType===type&&styles.choiceActive]}><Text style={[styles.choiceText,walletType===type&&styles.choiceTextActive]}>{type.replace('_',' ')}</Text></Pressable>)}
            </ScrollView>
            <Text style={styles.fieldLabel}>OPENING BALANCE (৳)</Text>
            <TextInput keyboardType="decimal-pad" value={walletOpeningBalance} onChangeText={setWalletOpeningBalance} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          </> : null}
          {walletType === 'credit_card' ? <>
            <Text style={styles.fieldLabel}>CREDIT LIMIT (৳)</Text>
            <TextInput keyboardType="decimal-pad" value={walletCreditLimit} onChangeText={setWalletCreditLimit} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          </> : null}
          <Text style={styles.fieldLabel}>NOTES (OPTIONAL)</Text>
          <TextInput value={walletNotes} onChangeText={setWalletNotes} placeholder="Add a note" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable disabled={saving} onPress={() => void saveWallet()} style={[styles.primaryButton,{marginTop:20}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':editingWalletId?'Update wallet':'Create wallet'}</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={debtModal} transparent animationType="slide" onRequestClose={() => {setDebtModal(false);setEditingDebtId(null);}}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingDebtId?'Edit Due & Debt record':'New Due & Debt record'}</Text><Pressable onPress={()=>{setDebtModal(false);setEditingDebtId(null);}}><Text style={styles.close}>✕</Text></Pressable></View>
          <View style={styles.typeSwitch}><Pressable onPress={()=>setDebtDirection('payable')} style={[styles.typeButton,debtDirection==='payable'&&styles.typeActive]}><Text style={[styles.typeText,debtDirection==='payable'&&styles.typeTextActive]}>I owe</Text></Pressable><Pressable onPress={()=>setDebtDirection('receivable')} style={[styles.typeButton,debtDirection==='receivable'&&styles.typeActive]}><Text style={[styles.typeText,debtDirection==='receivable'&&styles.typeTextActive]}>Owed to me</Text></Pressable></View>
          <Text style={styles.fieldLabel}>PERSON / ORGANIZATION</Text><TextInput value={debtName} onChangeText={setDebtName} placeholder="Name" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>PRINCIPAL (৳)</Text><TextInput keyboardType="decimal-pad" value={debtAmount} onChangeText={setDebtAmount} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>DUE DATE (YYYY-MM-DD, OPTIONAL)</Text><TextInput value={debtDueDate} onChangeText={setDebtDueDate} placeholder="2026-12-31" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>NOTE (OPTIONAL)</Text><TextInput value={debtNote} onChangeText={setDebtNote} placeholder="Details" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable disabled={saving} onPress={()=>void saveDebt()} style={[styles.primaryButton,{marginTop:16}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':editingDebtId?'Update record':'Create record'}</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={!!paymentDebtId} transparent animationType="slide" onRequestClose={()=>setPaymentDebtId(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Record payment</Text><Pressable onPress={()=>setPaymentDebtId(null)}><Text style={styles.close}>✕</Text></Pressable></View>
          <Text style={styles.fieldLabel}>PAYMENT AMOUNT (৳)</Text><TextInput keyboardType="decimal-pad" value={paymentAmount} onChangeText={setPaymentAmount} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>NOTE (OPTIONAL)</Text><TextInput value={paymentNote} onChangeText={setPaymentNote} placeholder="Payment details" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable disabled={saving} onPress={()=>void recordDebtPayment()} style={[styles.primaryButton,{marginTop:16}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':'Confirm payment'}</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={goalModal} transparent animationType="slide" onRequestClose={()=>{setGoalModal(false);setEditingGoalId(null);}}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingGoalId?'Edit savings goal':'New savings goal'}</Text><Pressable onPress={()=>{setGoalModal(false);setEditingGoalId(null);}}><Text style={styles.close}>✕</Text></Pressable></View>
          <Text style={styles.fieldLabel}>GOAL NAME</Text><TextInput value={goalName} onChangeText={setGoalName} placeholder="e.g. Emergency fund" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>TARGET AMOUNT (৳)</Text><TextInput keyboardType="decimal-pad" value={goalTarget} onChangeText={setGoalTarget} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.fieldLabel}>TARGET DATE (YYYY-MM-DD, OPTIONAL)</Text><TextInput value={goalTargetDate} onChangeText={setGoalTargetDate} placeholder="2027-06-30" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable disabled={saving} onPress={()=>void saveGoal()} style={[styles.primaryButton,{marginTop:16}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':editingGoalId?'Update goal':'Create goal'}</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={!!allocationGoalId} transparent animationType="slide" onRequestClose={()=>setAllocationGoalId(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{allocationAction==='allocate'?'Allocate to goal':'Release from goal'}</Text><Pressable onPress={()=>setAllocationGoalId(null)}><Text style={styles.close}>✕</Text></Pressable></View>
          <Text style={styles.fieldLabel}>WALLET</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{wallets.filter(w=>w.status==='active'&&w.walletType!=='credit_card').map(w=><Pressable key={w.id} onPress={()=>setAllocationWalletId(w.id)} style={[styles.choice,allocationWalletId===w.id&&styles.choiceActive]}><Text style={[styles.choiceText,allocationWalletId===w.id&&styles.choiceTextActive]}>{w.name}</Text></Pressable>)}</ScrollView>
          <Text style={styles.fieldLabel}>AMOUNT (৳)</Text><TextInput keyboardType="decimal-pad" value={allocationAmount} onChangeText={setAllocationAmount} placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable disabled={saving} onPress={()=>void saveGoalAllocation()} style={[styles.primaryButton,{marginTop:16}]}><Text style={styles.primaryButtonText}>{saving?'Saving…':allocationAction==='allocate'?'Allocate':'Release'}</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:theme.colors.background},
  center:{flex:1,backgroundColor:theme.colors.background,alignItems:'center',justifyContent:'center'},
  loadingText:{color:theme.colors.muted,fontSize:13,marginTop:14},
  errorTitle:{color:theme.colors.text,fontSize:22,fontWeight:'900',textAlign:'center'},
  errorMessage:{color:theme.colors.muted,fontSize:12,lineHeight:19,textAlign:'center',marginTop:10,maxWidth:300},
  retryButton:{backgroundColor:theme.colors.greenDeep,paddingHorizontal:26,paddingVertical:13,borderRadius:12,marginTop:22},
  retryText:{color:'#fff',fontSize:12,fontWeight:'900'},
  signOutButton:{paddingHorizontal:22,paddingVertical:12,marginTop:8},
  signOutText:{color:theme.colors.muted,fontSize:11,fontWeight:'800'},
  header:{paddingHorizontal:18,paddingTop:18,paddingBottom:10,flexDirection:'row',alignItems:'center'},
  brand:{fontSize:25,fontWeight:'900',color:theme.colors.text,letterSpacing:-1},
  headerMeta:{fontSize:8,color:theme.colors.muted,fontWeight:'800',letterSpacing:1,marginTop:3},
  avatar:{width:40,height:40,borderRadius:14,backgroundColor:theme.colors.greenDeep,alignItems:'center',justifyContent:'center'},
  avatarText:{color:'#fff',fontWeight:'900',fontSize:15},
  workspaceTabs:{paddingHorizontal:16,paddingVertical:8,gap:8},
  workspaceTab:{paddingHorizontal:16,paddingVertical:9,borderRadius:12,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.line},
  workspaceTabActive:{backgroundColor:theme.colors.greenDeep,borderColor:theme.colors.greenDeep},
  workspaceTabText:{color:theme.colors.muted,fontSize:11,fontWeight:'700'},
  workspaceTabTextActive:{color:'#fff'},
  moduleTabs:{paddingHorizontal:16,paddingBottom:10,gap:7},
  moduleTab:{paddingHorizontal:13,paddingVertical:8,borderRadius:999,backgroundColor:theme.colors.surfaceSoft,borderWidth:1,borderColor:theme.colors.line},
  moduleTabActive:{backgroundColor:theme.colors.greenSoft,borderColor:theme.colors.green},
  moduleTabText:{fontSize:10,color:theme.colors.muted,fontWeight:'700'},
  moduleTabTextActive:{color:theme.colors.green,fontWeight:'900'},
  notice:{marginHorizontal:16,marginBottom:8,padding:10,borderRadius:10,backgroundColor:'#edf3ed'},
  noticeText:{fontSize:10,color:theme.colors.greenDeep,lineHeight:15},
  body:{flex:1},
  bodyContent:{paddingHorizontal:17,paddingTop:12,paddingBottom:100},
  intro:{marginBottom:17},
  eyebrow:{fontSize:9,fontWeight:'900',letterSpacing:1.2,color:theme.colors.green,marginBottom:7},
  pageTitle:{fontSize:25,fontWeight:'900',letterSpacing:-.7,color:theme.colors.text,marginBottom:5},
  muted:{fontSize:11,color:theme.colors.muted,lineHeight:17,marginTop:4},
  panel:{backgroundColor:theme.colors.surface,borderRadius:18,borderWidth:1,borderColor:theme.colors.line,padding:16,marginBottom:10},
  hero:{backgroundColor:theme.colors.greenDeep,borderColor:theme.colors.greenDeep,padding:20,marginBottom:13},
  heroLabel:{color:'#c6d8c9',fontSize:9,fontWeight:'900',letterSpacing:1.1},
  heroValue:{color:'#fff',fontSize:31,fontWeight:'900',letterSpacing:-1,marginTop:11},
  heroHint:{color:'#d4e2d4',fontSize:10,marginTop:5},
  heroStats:{borderTopWidth:1,borderTopColor:'#ffffff30',marginTop:18,paddingTop:14,flexDirection:'row',justifyContent:'space-between'},
  heroStatLabel:{color:'#d4e2d4b8',fontSize:8,fontWeight:'800',letterSpacing:.8},
  heroStatValue:{color:'#fff',fontSize:14,fontWeight:'900',marginTop:5},
  metricGrid:{flexDirection:'row',gap:9,marginBottom:12},
  metric:{flex:1,marginBottom:0,padding:13},
  metricLabel:{fontSize:8,fontWeight:'900',letterSpacing:.8,color:theme.colors.muted},
  metricValue:{fontSize:17,fontWeight:'900',color:theme.colors.text,marginTop:7},
  sectionHead:{flexDirection:'row',alignItems:'center',marginTop:18,marginBottom:10},
  sectionTitle:{fontSize:17,fontWeight:'900',color:theme.colors.text},
  sectionSub:{fontSize:10,color:theme.colors.muted,marginTop:3},
  link:{fontSize:11,color:theme.colors.green,fontWeight:'800'},
  itemRow:{flexDirection:'row',alignItems:'center',paddingVertical:11,borderBottomWidth:1,borderBottomColor:theme.colors.line},
  itemIcon:{width:35,height:35,borderRadius:12,backgroundColor:theme.colors.greenSoft,alignItems:'center',justifyContent:'center'},
  itemIconText:{fontSize:13,color:theme.colors.green,fontWeight:'900'},
  itemCopy:{flex:1,marginLeft:10,marginRight:8},
  itemTitle:{fontSize:12,fontWeight:'800',color:theme.colors.text},
  itemAmount:{fontSize:11,fontWeight:'900',color:theme.colors.text},
  positive:{color:'#397a54'},
  negative:{color:'#b75235'},
  panelBig:{fontSize:25,fontWeight:'900',color:theme.colors.text,marginTop:7},
  smallButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:10,backgroundColor:theme.colors.greenDeep},
  smallButtonText:{color:'#fff',fontSize:11,fontWeight:'800'},
  reportRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:8,borderBottomWidth:1,borderBottomColor:theme.colors.line},
  progress:{height:7,borderRadius:99,backgroundColor:theme.colors.surfaceSoft,overflow:'hidden',marginVertical:12},
  progressFill:{height:7,backgroundColor:theme.colors.green,borderRadius:99},
  footer:{textAlign:'center',fontSize:8,color:theme.colors.muted,fontWeight:'800',letterSpacing:1,marginTop:25,marginBottom:18},
  bottomBar:{position:'absolute',bottom:0,left:0,right:0,flexDirection:'row',justifyContent:'space-around',paddingTop:10,paddingBottom:20,backgroundColor:theme.colors.surface,borderTopWidth:1,borderTopColor:theme.colors.line},
  bottomItem:{alignItems:'center',gap:4,flex:1},
  bottomDot:{width:5,height:5,borderRadius:5,backgroundColor:'transparent'},
  bottomDotActive:{backgroundColor:theme.colors.green},
  bottomText:{fontSize:8,color:theme.colors.muted,fontWeight:'700'},
  bottomTextActive:{color:theme.colors.green,fontWeight:'900'},
  fab:{position:'absolute',right:20,bottom:76,width:54,height:54,borderRadius:19,backgroundColor:theme.colors.greenDeep,alignItems:'center',justifyContent:'center',elevation:6},
  fabText:{color:'#fff',fontSize:30,fontWeight:'400',marginTop:-2},
  modalBackdrop:{flex:1,backgroundColor:'#0008',justifyContent:'flex-end'},
  modalCard:{backgroundColor:theme.colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:34,maxHeight:'90%'},
  modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:15},
  modalTitle:{fontSize:20,fontWeight:'900',color:theme.colors.text},
  close:{fontSize:19,color:theme.colors.muted,padding:5},
  typeSwitch:{flexDirection:'row',backgroundColor:theme.colors.surfaceSoft,borderRadius:12,padding:4,marginBottom:12},
  typeButton:{flex:1,alignItems:'center',padding:10,borderRadius:9},
  typeActive:{backgroundColor:theme.colors.greenDeep},
  typeText:{fontSize:12,color:theme.colors.muted,fontWeight:'800'},
  typeTextActive:{color:'#fff'},
  fieldLabel:{fontSize:10,fontWeight:'800',color:theme.colors.text,marginTop:10,marginBottom:6},
  input:{backgroundColor:theme.colors.surface,borderColor:theme.colors.line,borderWidth:1,borderRadius:11,paddingHorizontal:13,paddingVertical:12,color:theme.colors.text,fontSize:13},
  choice:{paddingHorizontal:12,paddingVertical:9,borderRadius:10,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.line,marginRight:7},
  choiceActive:{backgroundColor:theme.colors.greenSoft,borderColor:theme.colors.green},
  choiceText:{fontSize:10,color:theme.colors.muted,fontWeight:'700'},
  choiceTextActive:{color:theme.colors.green,fontWeight:'900'},
  primaryButton:{backgroundColor:theme.colors.greenDeep,padding:14,borderRadius:12,alignItems:'center',marginBottom:10},
  primaryButtonText:{color:'#fff',fontWeight:'900',fontSize:12},
  secondaryButton:{backgroundColor:theme.colors.surface,padding:14,borderRadius:12,alignItems:'center',borderWidth:1,borderColor:theme.colors.line},
  secondaryButtonText:{color:theme.colors.text,fontWeight:'800',fontSize:12},
});
