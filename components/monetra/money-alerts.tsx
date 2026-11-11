'use client';

import { useEffect, useMemo, useState } from 'react';
import { financeApiFetch } from '@/lib/native-api-fetch';
import { dhakaDateString } from '@/lib/dhaka-time';
import { AlertCircle, Bell, CalendarClock, CheckCircle2, Wallet } from 'lucide-react';

type Budget = { id: string; categoryName: string; limitMinor: number; carryInMinor: number; spentMinor: number };
type Recurring = { id: string; description: string; amountMinor: number; transactionType: 'income' | 'expense'; nextRun: string; enabled: boolean };
type WalletRow = { id: string; name: string; walletType: string; currentBalanceMinor: number; creditLimitMinor?: number };
type Debt = { id: string; direction: 'receivable' | 'payable'; counterpartyName: string; dueDate: string | null; outstandingMinor: number; status: string };
type AlertItem = { id: string; title: string; detail: string; amountMinor?: number; severity: number; target: 'tools' | 'due-debt' | 'wallets' };

const money = (minor: number) => new Intl.NumberFormat('en-BD', {
  style: 'currency', currency: 'BDT', maximumFractionDigits: 0,
}).format(minor / 100);
const dhakaToday = () => dhakaDateString();
const daysFromToday = (date: string) =>
  Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(dhakaToday() + 'T00:00:00Z')) / 86400000);

export function MoneyAlerts({ workspaceId, onNavigate }: { workspaceId: string; onNavigate: (view: 'tools' | 'due-debt' | 'wallets') => void }) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    const headers = { 'x-workspace-id': workspaceId };
    Promise.all([
      financeApiFetch('/api/finance-tools', { headers, cache: 'no-store' }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Alerts unavailable');
        return payload;
      }),
      financeApiFetch('/api/due-debt', { headers, cache: 'no-store' }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Due dates unavailable');
        return payload;
      }),
    ]).then(([tools, debtRows]) => {
      if (!active) return;
      setBudgets(Array.isArray(tools.budgets) ? tools.budgets : []);
      setRecurring(Array.isArray(tools.recurring) ? tools.recurring : []);
      setWallets(Array.isArray(tools.wallets) ? tools.wallets : []);
      setDebts(Array.isArray(debtRows) ? debtRows : []);
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [workspaceId]);

  const alerts = useMemo(() => {
    const items: AlertItem[] = [];
    for (const budget of budgets) {
      const limit = Number(budget.limitMinor) + Number(budget.carryInMinor || 0);
      const spent = Number(budget.spentMinor);
      const percent = limit > 0 ? spent / limit * 100 : 0;
      if (percent >= 100) items.push({ id: 'budget-' + budget.id, title: budget.categoryName + ' is over budget', detail: Math.round(percent) + '% used · ' + money(Math.max(0, spent - limit)) + ' over', amountMinor: spent, severity: 5, target: 'tools' });
      else if (percent >= 80) items.push({ id: 'budget-' + budget.id, title: budget.categoryName + ' is near its limit', detail: Math.round(percent) + '% of monthly budget used', amountMinor: spent, severity: 4, target: 'tools' });
      else if (percent >= 50) items.push({ id: 'budget-' + budget.id, title: budget.categoryName + ' budget halfway used', detail: Math.round(percent) + '% of monthly budget used', amountMinor: spent, severity: 2, target: 'tools' });
    }
    for (const debt of debts) {
      if (!debt.dueDate || debt.outstandingMinor <= 0 || debt.status === 'settled' || debt.status === 'archived') continue;
      const days = daysFromToday(debt.dueDate);
      if (days < 0) items.push({ id: 'debt-' + debt.id, title: (debt.direction === 'payable' ? 'Payment overdue: ' : 'Collection overdue: ') + debt.counterpartyName, detail: Math.abs(days) + ' day(s) overdue', amountMinor: debt.outstandingMinor, severity: 5, target: 'due-debt' });
      else if (days <= 7) items.push({ id: 'debt-' + debt.id, title: (debt.direction === 'payable' ? 'Payment due: ' : 'Collection expected: ') + debt.counterpartyName, detail: days === 0 ? 'Due today' : 'Due in ' + days + ' day(s)', amountMinor: debt.outstandingMinor, severity: 4, target: 'due-debt' });
    }
    for (const item of recurring) {
      if (!item.enabled) continue;
      const days = daysFromToday(item.nextRun);
      if (days <= 0) items.push({ id: 'recurring-' + item.id, title: 'Recurring item needs review: ' + item.description, detail: days < 0 ? Math.abs(days) + ' day(s) overdue · review before recording' : 'Scheduled for today · review before recording', amountMinor: item.amountMinor, severity: 4, target: 'tools' });
      else if (days <= 7) items.push({ id: 'recurring-' + item.id, title: 'Upcoming: ' + item.description, detail: 'Scheduled in ' + days + ' day(s)', amountMinor: item.amountMinor, severity: 2, target: 'tools' });
    }
    for (const wallet of wallets) {
      if (wallet.walletType === 'credit_card' && Number(wallet.creditLimitMinor) > 0) {
        const utilization = Number(wallet.currentBalanceMinor) / Number(wallet.creditLimitMinor) * 100;
        if (utilization >= 80) items.push({ id: 'wallet-' + wallet.id, title: wallet.name + ' credit usage is high', detail: Math.round(utilization) + '% of credit limit used', amountMinor: Number(wallet.currentBalanceMinor), severity: 3, target: 'wallets' });
      } else if (wallet.walletType !== 'credit_card' && Number(wallet.currentBalanceMinor) < 0) {
        items.push({ id: 'wallet-' + wallet.id, title: wallet.name + ' has a negative balance', detail: 'Review the shortfall and upcoming expenses', amountMinor: Math.abs(Number(wallet.currentBalanceMinor)), severity: 4, target: 'wallets' });
      }
    }
    return items.sort((a, b) => b.severity - a.severity).slice(0, 6);
  }, [budgets, recurring, wallets, debts]);

  return (
    <section className="surface-card money-alerts-card">
      <div className="section-heading">
        <div><p className="eyebrow">STAY AHEAD</p><h2>Money alerts</h2><p className="section-subtitle">Budget pressure, upcoming commitments and wallet warnings.</p></div>
        <span className="section-icon"><Bell size={18} /></span>
      </div>
      {loading ? <p className="section-subtitle">Checking your workspace…</p> : failed ? <p className="section-subtitle">Alerts could not be loaded. Refresh the workspace and try again.</p> : alerts.length ? (
        <div className="money-alert-list">{alerts.map(item => <button type="button" className={'money-alert-row severity-' + item.severity} key={item.id} onClick={() => onNavigate(item.target)}>
          <span className="money-alert-icon">{item.severity >= 4 ? <AlertCircle size={17} /> : item.target === 'due-debt' ? <CalendarClock size={17} /> : <Wallet size={17} />}</span>
          <span className="money-alert-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
          {item.amountMinor !== undefined && <b>{money(item.amountMinor)}</b>}
        </button>)}</div>
      ) : <div className="money-alert-clear"><CheckCircle2 size={19} /><span><strong>You're clear.</strong><small>No budget, due-date or wallet alerts right now.</small></span></div>}
    </section>
  );
}