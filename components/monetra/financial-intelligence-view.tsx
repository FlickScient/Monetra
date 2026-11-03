'use client';
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Calculator, CheckCircle2, ClipboardCheck, Lightbulb, PiggyBank, ShieldAlert, Target, TrendingUp, Wallet } from 'lucide-react';

type WalletRecord = { id: string; name: string; walletType: string; currentBalanceMinor: number; currency: string };
type TransactionRecord = { id: string; transactionType: 'income' | 'expense' | 'transfer'; walletId: string; amountMinor: number; description: string; occurredAt: string };
const money = (minor: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(Math.round(minor / 100));
const minor = (value: string) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

type DebtInput = { name: string; balance: number; rate: number };
function estimatePayoff(order: DebtInput[], monthlyBudget: number): { months: number | null; interest: number; reason?: string } {
  const balances = order.map(debt => ({ ...debt, interestDue: 0 }));
  if (!balances.length || monthlyBudget <= 0) return { months: null, interest: 0, reason: 'Enter balances and a monthly budget.' };
  let interestPaid = 0;
  for (let month = 1; month <= 600; month += 1) {
    let interestDue = 0;
    balances.forEach(debt => { const charge = Math.round(debt.balance * debt.rate / 1200); debt.balance += charge; debt.interestDue = charge; interestDue += charge; });
    if (monthlyBudget <= interestDue) return { months: null, interest: interestPaid + interestDue, reason: 'Budget does not cover monthly interest.' };
    let remaining = monthlyBudget;
    for (const debt of balances) {
      const paid = Math.min(remaining, debt.interestDue);
      debt.balance -= paid;
      remaining -= paid;
      interestPaid += paid;
    }
    for (const debt of order) {
      const current = balances.find(item => item.name === debt.name);
      if (!current || remaining <= 0) continue;
      const principal = Math.min(remaining, current.balance);
      current.balance -= principal;
      remaining -= principal;
    }
    if (balances.every(debt => debt.balance <= 0)) return { months: month, interest: interestPaid };
  }
  return { months: null, interest: interestPaid, reason: 'Payoff exceeds the 50-year simulation window.' };
}

function Field({ label, value, onChange, suffix = '৳', type = 'number' }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; type?: string }) {
  return <label className="intelligence-field"><span>{label}</span>{type === 'number' ? <div><input type="number" min="0" step="any" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="0" /><small>{suffix}</small></div> : <input type={type} value={value} onChange={e => onChange(e.target.value)} />}</label>;
}
function Card({ icon, eyebrow, title, description, children }: { icon: React.ReactNode; eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="surface-card intelligence-card"><div className="intelligence-card-heading"><span className="intelligence-icon">{icon}</span><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="section-subtitle">{description}</p></div></div>{children}</section>;
}

export function FinancialIntelligenceView({ wallets, transactions, monthlyIncomeMinor, monthlyExpenseMinor }: {
  wallets: WalletRecord[]; transactions: TransactionRecord[]; monthlyIncomeMinor: number; monthlyExpenseMinor: number;
}) {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate();
  const remaining = days - elapsed;
  const liquid = wallets.filter(w => w.walletType !== 'credit_card' && w.walletType !== 'savings').reduce((s, w) => s + Number(w.currentBalanceMinor || 0), 0);
  const projectedExpense = elapsed ? Math.round(monthlyExpenseMinor / elapsed * days) : monthlyExpenseMinor;
  const projectedIncome = elapsed ? Math.round(monthlyIncomeMinor / elapsed * days) : monthlyIncomeMinor;
  const reserve = Math.max(0, projectedExpense - monthlyExpenseMinor);
  const safeBuffer = liquid - reserve;

  const [purchase, setPurchase] = useState('');
  const [extraIncome, setExtraIncome] = useState('');
  const [extraExpense, setExtraExpense] = useState('');
  const scenario = safeBuffer + minor(extraIncome) - minor(extraExpense) - minor(purchase);

  const [goalName, setGoalName] = useState('Emergency fund');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [targetDate, setTargetDate] = useState(() => new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString().slice(0, 10));
  const months = Math.max(1, Math.ceil((new Date(targetDate + 'T12:00:00').getTime() - now.getTime()) / 2629800000));
  const goalGap = Math.max(0, minor(target) - minor(saved));

  const [walletId, setWalletId] = useState(wallets[0]?.id || '');
  const [counted, setCounted] = useState('');
  const wallet = wallets.find(w => w.id === walletId);
  const variance = wallet ? minor(counted) - Number(wallet.currentBalanceMinor) : 0;

  const [aName, setAName] = useState('Debt A'), [aBalance, setABalance] = useState(''), [aRate, setARate] = useState('');
  const [bName, setBName] = useState('Debt B'), [bBalance, setBBalance] = useState(''), [bRate, setBRate] = useState('');
  const [budget, setBudget] = useState('');
  const debts = [{ name: aName || 'Debt A', balance: minor(aBalance), rate: Number(aRate) || 0 }, { name: bName || 'Debt B', balance: minor(bBalance), rate: Number(bRate) || 0 }].filter(d => d.balance > 0);
  const snowball = [...debts].sort((a, b) => a.balance - b.balance);
  const avalanche = [...debts].sort((a, b) => b.rate - a.rate);
  const snowballEstimate = estimatePayoff(snowball, minor(budget));
  const avalancheEstimate = estimatePayoff(avalanche, minor(budget));

  const leakSignals = useMemo(() => {
    const cutoff = Date.now() - 45 * 86400000;
    const groups = new Map<string, TransactionRecord[]>();
    transactions.filter(t => t.transactionType === 'expense' && new Date(t.occurredAt).getTime() >= cutoff).forEach(t => {
      const key = t.description.trim().toLowerCase().replace(/\s+/g, ' ');
      if (key) groups.set(key, [...(groups.get(key) || []), t]);
    });
    return [...groups.entries()].filter(([, rows]) => rows.length >= 3).map(([name, rows]) => ({
      name: name.replace(/\b\w/g, c => c.toUpperCase()), count: rows.length, total: rows.reduce((s, r) => s + Number(r.amountMinor), 0),
    })).sort((a, b) => b.total - a.total).slice(0, 4);
  }, [transactions]);

  return <div className="page-stack module-page intelligence-page">
    <section className="page-intro"><div><p className="eyebrow">MONETRA INTELLIGENCE SUITE</p><h1>Financial Radar<span>.</span></h1><p className="intro-copy">See patterns, test decisions and keep your next move in view.</p></div><span className="module-intro-icon"><Activity size={22} /></span></section>
    <section className="radar-overview"><div className="radar-overview-copy"><i /> LIVE WORKSPACE ANALYSIS <small>Based on records in the selected workspace</small></div><div className="radar-metrics"><div><span>Projected month-end spend</span><strong>{money(projectedExpense)}</strong></div><div><span>Projected month-end income</span><strong>{money(projectedIncome)}</strong></div><div><span>Days remaining</span><strong>{remaining}</strong></div></div></section>
    <div className="intelligence-grid">
      <Card icon={<ShieldAlert size={19} />} eyebrow="SPENDING GUARDRAIL" title="Safe-to-Spend" description="An estimated buffer after your current spending pace.">
        <strong className="safe-spend-value">{money(safeBuffer)}</strong><div className={'intelligence-status ' + (safeBuffer >= 0 ? 'positive' : 'warning')}>{safeBuffer >= 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{safeBuffer >= 0 ? 'Projected buffer is positive' : 'Spending pace may exceed liquid balances'}</div>
        <div className="intelligence-mini-stats"><span>Liquid wallets <b>{money(liquid)}</b></span><span>Remaining projected spend <b>{money(reserve)}</b></span></div>
        <p className="intelligence-disclaimer">Estimate only. Excludes unrecorded bills, debts, pending transactions and savings wallets. Uses this month's expense pace.</p>
      </Card>
      <Card icon={<TrendingUp size={19} />} eyebrow="EARLY WARNING SYSTEM" title="Financial Radar" description="Straight-line month-end projection from recorded totals.">
        <div className="radar-progress-label"><span>Month elapsed</span><b>{Math.round(elapsed / days * 100)}%</b></div><div className="radar-progress"><span style={{ width: (elapsed / days * 100) + '%' }} /></div>
        <div className="radar-comparison"><div><small>Recorded net flow</small><b className={monthlyIncomeMinor >= monthlyExpenseMinor ? 'positive-text' : 'negative-text'}>{money(monthlyIncomeMinor - monthlyExpenseMinor)}</b></div><div><small>Projected month-end net</small><b>{money(projectedIncome - projectedExpense)}</b></div></div>
        <p className="intelligence-disclaimer">Not a predictive model. Accuracy improves with consistent transaction records.</p>
      </Card>
      <Card icon={<Lightbulb size={19} />} eyebrow="PATTERN REVIEW" title="Quiet Leak Detector" description="Repeated expense descriptions worth reviewing—not confirmed subscriptions.">
        {leakSignals.length ? <div className="leak-list">{leakSignals.map(x => <div className="leak-row" key={x.name}><span><b>{x.name}</b><small>{x.count} entries in 45 days</small></span><strong>{money(x.total)}</strong></div>)}</div> : <div className="intelligence-empty"><CheckCircle2 size={18} />No repeated expense descriptions found in loaded transactions.</div>}
        <p className="intelligence-disclaimer">Checks only currently loaded transactions. Repeated names can be normal spending.</p>
      </Card>
      <Card icon={<Calculator size={19} />} eyebrow="DECISION LAB" title="What-If Simulator" description="Test a purchase or income change without touching real records.">
        <div className="intelligence-form-grid"><Field label="One-time purchase" value={purchase} onChange={setPurchase} /><Field label="Extra income" value={extraIncome} onChange={setExtraIncome} /><Field label="Extra expense" value={extraExpense} onChange={setExtraExpense} /></div>
        <div className="scenario-result"><span>Estimated buffer after scenario</span><strong className={scenario >= 0 ? 'positive-text' : 'negative-text'}>{money(scenario)}</strong></div><p className="intelligence-disclaimer">Scenario only. Nothing is saved or changed in your ledger.</p>
      </Card>
      <Card icon={<Target size={19} />} eyebrow="FLEXIBLE SAVING PLAN" title="Adaptive Goals" description="Calculate the monthly pace needed to reach a target.">
        <div className="intelligence-form-grid"><Field label="Goal name" type="text" suffix="" value={goalName} onChange={setGoalName} /><Field label="Target date" type="date" suffix="" value={targetDate} onChange={setTargetDate} /><Field label="Target amount" value={target} onChange={setTarget} /><Field label="Already saved" value={saved} onChange={setSaved} /></div>
        <div className="scenario-result"><span>{goalName || 'Your goal'} · {months} months</span><strong>{money(Math.ceil(goalGap / months))} / month</strong></div><p className="intelligence-disclaimer">{goalGap ? 'Planning calculation only; goal is not saved to your account yet.' : 'The amount entered already covers this target.'}</p>
      </Card>
      <Card icon={<ClipboardCheck size={19} />} eyebrow="CASH CONTROL" title="Cash Reconciliation" description="Compare the recorded wallet balance with the amount counted.">
        {wallets.length ? <><label className="intelligence-field"><span>Wallet to reconcile</span><select value={walletId} onChange={e => { setWalletId(e.target.value); setCounted(''); }}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label><div className="intelligence-mini-stats"><span>Recorded balance <b>{money(Number(wallet?.currentBalanceMinor || 0))}</b></span></div><Field label="Actual counted balance" value={counted} onChange={setCounted} />{counted !== '' && <div className={'intelligence-status ' + (variance === 0 ? 'positive' : 'warning')}>{variance === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{variance === 0 ? 'Balances match' : (variance > 0 ? 'Surplus of ' : 'Shortage of ') + money(Math.abs(variance))}</div>}</> : <div className="intelligence-empty"><Wallet size={18} />Add a wallet to reconcile a balance.</div>}
        <p className="intelligence-disclaimer">Local comparison only. Does not adjust wallet balance or create a transaction.</p>
      </Card>
      <Card icon={<PiggyBank size={19} />} eyebrow="REPAYMENT PLANNER" title="Debt Strategy Engine" description="Compare Snowball and Avalanche payoff priorities.">
        <div className="debt-simulator-grid"><div className="debt-simulator-item"><b>Debt A</b><Field label="Name" type="text" suffix="" value={aName} onChange={setAName} /><Field label="Balance" value={aBalance} onChange={setABalance} /><Field label="Annual interest" value={aRate} onChange={setARate} suffix="%" /></div><div className="debt-simulator-item"><b>Debt B</b><Field label="Name" type="text" suffix="" value={bName} onChange={setBName} /><Field label="Balance" value={bBalance} onChange={setBBalance} /><Field label="Annual interest" value={bRate} onChange={setBRate} suffix="%" /></div></div>
        <Field label="Monthly repayment budget" value={budget} onChange={setBudget} />
        {debts.length && minor(budget) ? <div className="debt-order-results"><div><small>SNOWBALL · LOWEST BALANCE FIRST</small><b>{snowball.map(d => d.name).join(' → ')}</b><span>{snowballEstimate.months ? snowballEstimate.months + ' months · ' + money(snowballEstimate.interest) + ' estimated interest' : snowballEstimate.reason}</span></div><div><small>AVALANCHE · HIGHEST INTEREST FIRST</small><b>{avalanche.map(d => d.name).join(' → ')}</b><span>{avalancheEstimate.months ? avalancheEstimate.months + ' months · ' + money(avalancheEstimate.interest) + ' estimated interest' : avalancheEstimate.reason}</span></div></div> : <p className="intelligence-disclaimer">Enter debt balances and a monthly repayment budget to compare payoff priorities.</p>}
        <p className="intelligence-disclaimer">Estimate assumes the budget covers monthly interest first, then targets principal in the chosen order. It excludes lender minimums, fees and changing rates. No debt records are changed.</p>
      </Card>
    </div>
    <footer className="intelligence-footer"><Activity size={15} />Calculations use loaded records and selected workspace. Estimates never silently modify your ledger.</footer>
  </div>;
}
