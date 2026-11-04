'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, PiggyBank, Plus, Target, Trash2, Wallet } from 'lucide-react';

type WalletRecord = { id: string; name: string; walletType: string; currentBalanceMinor: number; currency: string };
type Allocation = { id?: string; walletId: string; amountMinor: number };
type Goal = { id: string; name: string; targetMinor: number; targetDate: string | null; currency: string; allocations: Allocation[]; createdAt: string };
const formatMoney = (minor: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(Math.round(minor / 100));
const parseMoney = (value: string) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

export function SavingsGoalsView({ workspaceId, wallets }: { workspaceId: string; wallets: WalletRecord[] }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [activeGoal, setActiveGoal] = useState('');
  const [sourceWallet, setSourceWallet] = useState(wallets[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setGoals([]);
    setLoading(true);
    setError('');
    fetch('/api/goals', { headers: { 'x-workspace-id': workspaceId } })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load savings goals.');
        return data;
      })
      .then(data => { if (active) setGoals(Array.isArray(data) ? data : []); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load savings goals.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  const allocatedByWallet = useMemo(() => {
    const totals = new Map<string, number>();
    goals.forEach(goal => goal.allocations.forEach(item => totals.set(item.walletId, (totals.get(item.walletId) || 0) + Number(item.amountMinor))));
    return totals;
  }, [goals]);
  const availableForWallet = (walletId: string) => {
    const wallet = wallets.find(item => item.id === walletId);
    return Math.max(0, Number(wallet?.currentBalanceMinor || 0) - (allocatedByWallet.get(walletId) || 0));
  };
  const totalAllocated = goals.reduce((sum, goal) => sum + goal.allocations.reduce((s, item) => s + Number(item.amountMinor), 0), 0);

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetMinor = parseMoney(target);
    if (!name.trim() || !targetMinor) { setError('Enter a goal name and a valid target amount.'); return; }
    setError('');
    try {
      const response = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ name: name.trim(), targetMinor, currency: 'BDT', targetDate: targetDate || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not create this goal.');
      setGoals(current => [{ ...data, allocations: [] }, ...current]);
      setName(''); setTarget(''); setTargetDate('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create this goal.'); }
  }

  async function moveMoney(event: FormEvent<HTMLFormElement>, mode: 'allocate' | 'release') {
    event.preventDefault();
    const value = parseMoney(amount);
    const goal = goals.find(item => item.id === activeGoal);
    if (!goal || !sourceWallet || !value) { setError('Choose a goal, wallet and valid amount.'); return; }
    const currentInWallet = goal.allocations.find(item => item.walletId === sourceWallet)?.amountMinor || 0;
    if (mode === 'allocate' && value > availableForWallet(sourceWallet)) { setError('That wallet does not have enough unallocated money.'); return; }
    if (mode === 'release' && value > currentInWallet) { setError('You cannot release more than this goal holds in the selected wallet.'); return; }
    setError('');
    try {
      const response = await fetch('/api/goals/' + activeGoal + '/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ walletId: sourceWallet, amountMinor: value, action: mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update this allocation.');
      const next = currentInWallet + (mode === 'allocate' ? value : -value);
      setGoals(current => current.map(item => item.id !== activeGoal ? item : {
        ...item,
        allocations: item.allocations.filter(allocation => allocation.walletId !== sourceWallet)
          .concat(next > 0 ? [{ walletId: sourceWallet, amountMinor: next }] : []),
      }));
      setAmount('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update this allocation.'); }
  }

  async function deleteGoal(goal: Goal) {
    const prompt = goal.allocations.length
      ? 'Delete this goal and release its wallet allocations?'
      : 'Delete this savings goal?';
    if (!window.confirm(prompt)) return;
    setError('');
    try {
      for (const allocation of goal.allocations) {
        const response = await fetch('/api/goals/' + goal.id + '/allocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
          body: JSON.stringify({ walletId: allocation.walletId, amountMinor: Number(allocation.amountMinor), action: 'release' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not release a goal allocation.');
      }
      const response = await fetch('/api/goals/' + goal.id, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not archive this goal.');
      setGoals(current => current.filter(item => item.id !== goal.id));
      if (activeGoal === goal.id) setActiveGoal('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not archive this goal.'); }
  }

  return <div className="page-stack module-page">
    <section className="page-intro"><div><p className="eyebrow">PLAN WITH PURPOSE</p><h1>Savings Goals<span>.</span></h1><p className="intro-copy">Give every saved taka a destination, without inventing extra money.</p></div><span className="module-intro-icon"><Target size={22}/></span></section>
    {error && <p className="due-form-error">{error}</p>}
    <section className="due-summary-grid">
      <article className="module-summary-card"><span className="module-summary-icon receivable"><PiggyBank size={18}/></span><span className="module-summary-label">TOTAL ALLOCATED</span><strong>{formatMoney(totalAllocated)}</strong><small>Reserved across your goals</small></article>
      <article className="module-summary-card"><span className="module-summary-icon neutral"><Target size={18}/></span><span className="module-summary-label">ACTIVE GOALS</span><strong>{goals.length}</strong><small>In this workspace</small></article>
      <article className="module-summary-card"><span className="module-summary-icon payable"><Wallet size={18}/></span><span className="module-summary-label">WALLETS TRACKED</span><strong>{wallets.length}</strong><small>Actual accounts, not virtual money</small></article>
    </section>
    <div className="module-notice"><PiggyBank size={18}/><p><strong>Wallets hold the money. Goals give it a purpose.</strong><span>Allocations reserve part of an existing wallet balance. They do not create transactions, change your balance, or count as additional assets.</span></p></div>
    <div className="dashboard-grid">
      <section className="surface-card due-ledger">
        <div className="section-heading"><div><p className="eyebrow">YOUR PLAN</p><h2>Build a savings goal</h2><p className="section-subtitle">PC, emergency fund, travel, education—anything.</p></div><span className="section-icon"><Plus size={18}/></span></div>
        <form className="due-form" onSubmit={createGoal}>
          <label>Goal name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. PC Fund" required /></label>
          <label>Target amount (৳)<input type="number" min="0.01" step="0.01" value={target} onChange={e=>setTarget(e.target.value)} placeholder="50000" required /></label>
          <label>Target date (optional)<input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} /></label>
          <button className="primary-btn" type="submit"><Plus size={15}/> Create goal</button>
        </form>
      </section>
      <section className="surface-card due-ledger">
        <div className="section-heading"><div><p className="eyebrow">REAL BALANCES</p><h2>Wallet availability</h2><p className="section-subtitle">Balance minus allocations across all goals.</p></div><span className="section-icon"><Wallet size={18}/></span></div>
        {wallets.length ? <div className="due-attention-list">{wallets.map(wallet => <div key={wallet.id}><span><b>{wallet.name}</b><small>{wallet.walletType.replace('_',' ')}</small></span><strong>{formatMoney(availableForWallet(wallet.id))}</strong></div>)}</div> : <p className="due-muted">Create a wallet before allocating savings.</p>}
      </section>
    </div>
    <section className="surface-card due-ledger">
      <div className="section-heading"><div><p className="eyebrow">YOUR SAVINGS</p><h2>Goals & allocations</h2><p className="section-subtitle">Allocate from real wallets, or release money when plans change.</p></div><span className="section-icon"><Target size={18}/></span></div>
      {loading ? <p className="due-muted">Loading your goals…</p> : goals.length ? <div className="due-record-list">{goals.map(goal => {
        const saved = goal.allocations.reduce((sum,item)=>sum+Number(item.amountMinor),0);
        const progress = goal.targetMinor ? Math.min(100, saved / Number(goal.targetMinor) * 100) : 0;
        return <article className="due-record" key={goal.id}><div className="due-record-mark receivable"><Target size={17}/></div><div className="due-record-main"><div className="due-record-title"><strong>{goal.name}</strong><span className="due-direction receivable">{Math.round(progress)}% FUNDED</span></div><p>{formatMoney(saved)} saved of {formatMoney(Number(goal.targetMinor))}{goal.targetDate ? ' · Target '+goal.targetDate : ''}</p><div className="due-record-progress"><span style={{width:progress+'%'}}/></div><small>{goal.allocations.map(a=>wallets.find(w=>w.id===a.walletId)?.name || 'Unavailable wallet').join(' · ') || 'No money allocated yet'}</small></div><div className="due-record-balance"><strong>{formatMoney(Math.max(0,Number(goal.targetMinor)-saved))}</strong><small>Remaining</small></div><div className="due-record-actions"><button className="due-repay-btn" onClick={()=>{setActiveGoal(goal.id);setAmount('');setError('');}}> <Plus size={14}/> Manage funds</button><button className="due-delete-btn" onClick={()=>deleteGoal(goal)} aria-label={'Delete '+goal.name}><Trash2 size={14}/></button></div></article>;
      })}</div> : <div className="module-empty-state due-empty"><span><Target size={20}/></span><strong>No savings goals yet</strong><p>Create a goal and start assigning money from your existing wallets.</p></div>}
    </section>
    {activeGoal && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setActiveGoal('');}}><section className="modal-card due-modal" role="dialog" aria-modal="true" aria-labelledby="goal-funds-title"><div className="modal-heading"><div><p className="eyebrow">GOAL ALLOCATION</p><h2 id="goal-funds-title">{goals.find(g=>g.id===activeGoal)?.name}</h2></div><button className="icon-btn" onClick={()=>setActiveGoal('')} aria-label="Close">×</button></div><form className="due-form" onSubmit={e=>moveMoney(e,'allocate')}><label>Source wallet<select value={sourceWallet} onChange={e=>setSourceWallet(e.target.value)} required>{wallets.map(w=><option key={w.id} value={w.id}>{w.name} · Available {formatMoney(availableForWallet(w.id))}</option>)}</select></label><label>Amount to allocate (৳)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/></label><button className="primary-btn" type="submit"><ArrowDownToLine size={15}/> Allocate money</button></form><form className="due-form" onSubmit={e=>moveMoney(e,'release')}><label>Amount to release (৳)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/></label><button className="secondary-btn" type="submit"><ArrowUpFromLine size={15}/> Release allocation</button></form><p className="due-muted">Allocations are stored in your account. They do not move money between bank accounts or wallets.</p></section></div>}
    <div className="due-integrity-note"><Wallet size={15}/> Savings goals and wallet allocations are saved to your account and synced across devices.</div>
  </div>;
}
