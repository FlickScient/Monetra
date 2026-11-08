'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { financeApiFetch } from '@/lib/native-api-fetch';
import { dhakaDateString } from '@/lib/dhaka-time';
import { CalendarDays, CheckCircle2, CirclePause, CirclePlay, ClipboardList, Plus, RefreshCw, Wallet } from 'lucide-react';

type WalletRow = { id: string; name: string; currency: string; currentBalanceMinor: number };
type CategoryRow = { id: string; name: string; color: string; categoryType: 'income' | 'expense' };
type BudgetRow = { id: string; categoryId: string; categoryName: string; categoryColor: string; monthStart: string; limitMinor: number; carryInMinor: number; spentMinor: number; carryForward: boolean };
type RecurringRow = { id: string; transactionType: 'income' | 'expense'; walletId: string; walletName: string | null; categoryId: string | null; description: string; amountMinor: number; frequency: 'weekly' | 'monthly' | 'yearly'; nextRun: string; enabled: boolean };
type ReconciliationRow = { id: string; walletId: string; walletName: string | null; recordedMinor: number; actualMinor: number; varianceMinor: number; note: string | null; createdAt: string };
type DebtRow = { id: string; direction: 'receivable' | 'payable'; counterpartyName: string; dueDate: string | null; outstandingMinor: number; status: string };
type Payload = { monthStart: string; budgets: BudgetRow[]; recurring: RecurringRow[]; wallets: WalletRow[]; reconciliations: ReconciliationRow[]; audit: { id: string; summary: string; createdAt: string }[] };
const money = (minor: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(Math.round(minor / 100));
const toMinor = (value: string) => { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : -1; };
const today = () => dhakaDateString();

export function FinanceOperationsView({ workspaceId, categories }: { workspaceId: string; categories: CategoryRow[] }) {
  const [data, setData] = useState<Payload | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'budgets' | 'recurring' | 'calendar' | 'reconcile' | 'activity'>('budgets');
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [carryForward, setCarryForward] = useState(false);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [walletId, setWalletId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [nextRun, setNextRun] = useState(today());
  const [reconcileWallet, setReconcileWallet] = useState('');
  const [actualBalance, setActualBalance] = useState('');
  const [reconcileNote, setReconcileNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const headers = { 'x-workspace-id': workspaceId };
      const [toolsRes, debtRes] = await Promise.all([financeApiFetch('/api/finance-tools', { headers }), financeApiFetch('/api/due-debt', { headers })]);
      const [toolsData, debtData] = await Promise.all([toolsRes.json(), debtRes.json()]);
      if (!toolsRes.ok) throw new Error(toolsData.error || 'Could not load finance tools.');
      if (!debtRes.ok) throw new Error(debtData.error || 'Could not load due dates.');
      setData(toolsData); setDebts(Array.isArray(debtData) ? debtData : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load finance tools.'); }
    finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (data?.wallets.length && !data.wallets.some(wallet => wallet.id === walletId)) setWalletId(data.wallets[0].id);
    if (data?.wallets.length && !data.wallets.some(wallet => wallet.id === reconcileWallet)) setReconcileWallet(data.wallets[0].id);
  }, [data, walletId, reconcileWallet]);
  useEffect(() => {
    const expenses = categories.filter(category => category.categoryType === 'expense');
    if (expenses.length && !expenses.some(category => category.id === budgetCategory)) setBudgetCategory(expenses[0].id);
    const matching = categories.filter(category => category.categoryType === type);
    if (matching.length && !matching.some(category => category.id === categoryId)) setCategoryId(matching[0].id);
  }, [categories, budgetCategory, categoryId, type]);

  const calendarItems = useMemo(() => {
    const recurring = (data?.recurring || []).filter(item => item.enabled).map(item => ({ date: item.nextRun, title: item.description, detail: item.frequency + ' · ' + (item.transactionType === 'income' ? 'Expected income' : 'Expected expense'), amount: item.amountMinor, incoming: item.transactionType === 'income' }));
    const due = debts.filter(item => item.dueDate && item.outstandingMinor > 0 && item.status !== 'settled').map(item => ({ date: item.dueDate as string, title: item.counterpartyName, detail: item.direction === 'payable' ? 'Debt repayment due' : 'Expected collection', amount: item.outstandingMinor, incoming: item.direction === 'receivable' }));
    return [...recurring, ...due].filter(item => item.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40);
  }, [data, debts]);

  async function submit(kind: string, payload: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/finance-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ kind, ...payload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save this item.');
      setNotice(kind === 'reconciliation' ? 'Reconciliation saved. Your wallet balance was not changed.' : 'Saved successfully.');
      await load();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save this item.'); return false; }
    finally { setBusy(false); }
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = toMinor(budgetAmount);
    if (!budgetCategory || amount <= 0) { setError('Choose a category and enter a positive budget.'); return; }
    if (await submit('budget', { categoryId: budgetCategory, limitMinor: amount, carryForward })) setBudgetAmount('');
  }
  async function saveRecurring(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = toMinor(recurringAmount);
    if (!walletId || amount <= 0 || !description.trim()) { setError('Complete the recurring transaction details.'); return; }
    if (await submit('recurring', { transactionType: type, walletId, categoryId: categoryId || null, description: description.trim(), amountMinor: amount, frequency, nextRun })) { setDescription(''); setRecurringAmount(''); }
  }
  async function saveReconciliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = toMinor(actualBalance);
    if (!reconcileWallet || amount < 0) { setError('Enter the actual balance, including zero if applicable.'); return; }
    if (await submit('reconciliation', { walletId: reconcileWallet, actualMinor: amount, note: reconcileNote.trim() || null })) { setActualBalance(''); setReconcileNote(''); }
  }
  async function runRecurring(item: RecurringRow) {
    if (item.nextRun < today() && !window.confirm('This schedule has missed dates. Record every due occurrence, up to 24 per click, as separate transactions?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/finance-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ kind: 'recurring-run', id: item.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not record scheduled transaction.');
      setNotice('Recorded ' + (result.recordedCount || 0) + ' due occurrence(s). Next occurrence: ' + result.nextRun + (result.moreDue ? ' · More overdue dates remain; record again to continue.' : '.')); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record scheduled transaction.'); }
    finally { setBusy(false); }
  }

  async function skipRecurring(item: RecurringRow) {
    if (!window.confirm('Skip this scheduled occurrence without recording a transaction?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/finance-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ kind: 'recurring-skip', id: item.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not skip this occurrence.');
      setNotice('Skipped this occurrence. Next date: ' + result.nextRun + '.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not skip this occurrence.'); }
    finally { setBusy(false); }
  }

  async function toggleRecurring(item: RecurringRow) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/finance-tools', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ id: item.id, enabled: !item.enabled }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not update schedule.');
      setNotice(item.enabled ? 'Schedule paused.' : 'Schedule resumed.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update schedule.'); }
    finally { setBusy(false); }
  }

  const tabs = [{ id: 'budgets', label: 'Smart budgets' }, { id: 'recurring', label: 'Recurring' }, { id: 'calendar', label: 'Cash calendar' }, { id: 'reconcile', label: 'Reconciliation' }, { id: 'activity', label: 'Activity history' }] as const;
  return <div className="page-stack module-page finance-ops-page">
    <section className="page-intro"><div><p className="eyebrow">MONETRA MONEY SYSTEMS</p><h1>Money Tools<span>.</span></h1><p className="intro-copy">Plan spending, prepare for upcoming commitments and keep your balances honest.</p></div><span className="module-intro-icon"><ClipboardList size={22}/></span></section>
    <div className="finance-ops-tabs" role="tablist" aria-label="Money tools">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setError(''); setNotice(''); }}>{item.label}</button>)}</div>
    {error && <p className="form-error">{error}</p>}{notice && <p className="category-notice">{notice}</p>}
    {loading ? <div className="surface-card"><p className="section-subtitle">Loading workspace tools…</p></div> : <>
      {tab === 'budgets' && <section className="surface-card finance-ops-card">
        <div className="section-heading"><div><p className="eyebrow">MONTHLY GUARDRAILS</p><h2>Category budgets</h2><p className="section-subtitle">Alerts at 50%, 80% and 100%. Budgets never change wallet balances.</p></div></div>
        <form className="finance-ops-form" onSubmit={saveBudget}>
          <label>Expense category<select value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)}>{categories.filter(c => c.categoryType === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Monthly limit (৳)<input type="number" min="0.01" step="0.01" value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} placeholder="e.g. 5000" required /></label>
          <label className="finance-ops-check"><input type="checkbox" checked={carryForward} onChange={e => setCarryForward(e.target.checked)}/> Carry unused budget forward</label>
          <button className="primary-btn" type="submit" disabled={busy || !categories.some(c => c.categoryType === 'expense')}><Plus size={15}/> Save budget</button>
        </form>
        <div className="finance-ops-list">{(data?.budgets || []).map(item => { const effectiveLimit = item.limitMinor + item.carryInMinor; const percent = effectiveLimit ? item.spentMinor / effectiveLimit * 100 : 0; const level = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : percent >= 50 ? 'notice' : 'safe'; return <div className="finance-budget-row" key={item.id}><div className="finance-ops-row-top"><strong>{item.categoryName}</strong><span>{money(item.spentMinor)} / {money(effectiveLimit)}</span></div><div className="finance-ops-progress"><span className={level} style={{ width: Math.min(100, percent) + '%' }}/></div><small>{percent >= 100 ? 'Over budget' : percent >= 80 ? '80%+ · Near limit' : percent >= 50 ? '50%+ · Half used' : 'Within budget'}{item.carryInMinor > 0 ? ' · ' + money(item.carryInMinor) + ' carried from last month' : ''}</small></div>; })}{!data?.budgets.length && <p className="section-subtitle">No budgets set for this month yet.</p>}</div>
      </section>}
      {tab === 'recurring' && <section className="surface-card finance-ops-card">
        <div className="section-heading"><div><p className="eyebrow">REPEAT WITH CONTROL</p><h2>Recurring schedules</h2><p className="section-subtitle">Track salary, rent, subscriptions and bills. Due schedules are recorded only when you choose Record due; missed dates are caught up in safe batches of up to 24. Each occurrence has a duplicate-safe key.</p></div></div>
        <form className="finance-ops-form" onSubmit={saveRecurring}>
          <label>Type<select value={type} onChange={e => setType(e.target.value as 'income' | 'expense')}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          <label>Description<input value={description} onChange={e => setDescription(e.target.value)} maxLength={160} placeholder="Rent / Salary / Internet" required/></label>
          <label>Amount (৳)<input type="number" min="0.01" step="0.01" value={recurringAmount} onChange={e => setRecurringAmount(e.target.value)} required/></label>
          <label>Wallet<select value={walletId} onChange={e => setWalletId(e.target.value)}>{data?.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>Category<select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Uncategorized</option>{categories.filter(c => c.categoryType === type).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Frequency<select value={frequency} onChange={e => setFrequency(e.target.value as typeof frequency)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
          <label>Next date<input type="date" value={nextRun} onChange={e => setNextRun(e.target.value)} required/></label>
          <button className="primary-btn" type="submit" disabled={busy || !data?.wallets.length}><Plus size={15}/> Add schedule</button>
        </form>
        <div className="finance-ops-list">{(data?.recurring || []).map(item => <div className="finance-ops-row" key={item.id}><div><strong>{item.description}</strong><small>{item.walletName || 'Wallet'} · {item.frequency} · Next {item.nextRun}</small></div><div className="finance-ops-row-end"><b>{money(item.amountMinor)}</b>{item.enabled && item.nextRun <= today() && <><button type="button" className="secondary-btn" disabled={busy} onClick={() => void runRecurring(item)}><CheckCircle2 size={14}/> Record due</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => void skipRecurring(item)}>Skip occurrence</button></>}<button type="button" className="secondary-btn" disabled={busy} onClick={() => void toggleRecurring(item)}>{item.enabled ? <><CirclePause size={14}/> Pause</> : <><CirclePlay size={14}/> Resume</>}</button></div></div>)}{!data?.recurring.length && <p className="section-subtitle">No recurring schedules yet.</p>}</div>
      </section>}
      {tab === 'calendar' && <section className="surface-card finance-ops-card">
        <div className="section-heading"><div><p className="eyebrow">NEXT COMMITMENTS</p><h2>Cash-flow calendar</h2><p className="section-subtitle">Upcoming recurring reminders and Due & Debt dates, in date order.</p></div><CalendarDays size={20}/></div>
        <div className="finance-calendar-list">{calendarItems.map((item, index) => <div className="finance-calendar-row" key={item.date + item.title + index}><time>{new Date(item.date + 'T12:00:00+06:00').toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })}</time><div><strong>{item.title}</strong><small>{item.detail}</small></div><b className={item.incoming ? 'positive-text' : 'negative-text'}>{item.incoming ? '+' : '−'}{money(item.amount)}</b></div>)}{!calendarItems.length && <p className="section-subtitle">No upcoming items. Add recurring schedules or due dates to populate the calendar.</p>}</div>
      </section>}
      {tab === 'reconcile' && <section className="surface-card finance-ops-card">
        <div className="section-heading"><div><p className="eyebrow">BALANCE INTEGRITY</p><h2>Wallet reconciliation</h2><p className="section-subtitle">Compare recorded and counted balances. Saving a check never changes your wallet or ledger.</p></div><Wallet size={20}/></div>
        <form className="finance-ops-form" onSubmit={saveReconciliation}>
          <label>Wallet<select value={reconcileWallet} onChange={e => setReconcileWallet(e.target.value)}>{data?.wallets.map(w => <option key={w.id} value={w.id}>{w.name} · {money(w.currentBalanceMinor)}</option>)}</select></label>
          <label>Actual counted balance (৳)<input type="number" min="0" step="0.01" value={actualBalance} onChange={e => setActualBalance(e.target.value)} required/></label>
          <label>Note (optional)<input value={reconcileNote} onChange={e => setReconcileNote(e.target.value)} maxLength={500} placeholder="Counted cash / bank statement"/></label>
          <button className="primary-btn" type="submit" disabled={busy || !data?.wallets.length}><CheckCircle2 size={15}/> Save check</button>
        </form>
        <div className="finance-ops-list">{(data?.reconciliations || []).map(item => <div className="finance-ops-row" key={item.id}><div><strong>{item.walletName || 'Wallet'} · {new Date(item.createdAt).toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka' })}</strong><small>Recorded {money(item.recordedMinor)} · Actual {money(item.actualMinor)}{item.note ? ' · ' + item.note : ''}</small></div><b className={item.varianceMinor === 0 ? 'positive-text' : 'negative-text'}>{item.varianceMinor > 0 ? '+' : ''}{money(item.varianceMinor)}</b></div>)}{!data?.reconciliations.length && <p className="section-subtitle">No reconciliation checks recorded yet.</p>}</div>
      </section>}
      {tab === 'activity' && <section className="surface-card finance-audit-card"><div className="section-heading"><div><p className="eyebrow">THE PAPER TRAIL</p><h2>Activity history</h2><p className="section-subtitle">Recent transactions, repayments, savings and workspace changes.</p></div><RefreshCw size={18}/></div>{(data?.audit || []).map(item => <div className="finance-audit-row" key={item.id}><span>{item.summary}</span><small>{new Date(item.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</small></div>)}{!data?.audit.length && <p className="section-subtitle">No changes recorded yet.</p>}</section>}
    </>}
  </div>;
}
