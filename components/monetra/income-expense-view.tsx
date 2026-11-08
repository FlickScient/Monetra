'use client';

import { useEffect, useMemo, useState } from 'react';
import { financeApiFetch } from '@/lib/native-api-fetch';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, ChevronDown, ChevronUp, Plus, RefreshCw, Search } from 'lucide-react';
import { dhakaMonthStart, shiftMonthStart } from '@/lib/dhaka-time';

type LedgerEntry = {
  id: string; transactionType: 'income' | 'expense'; amountMinor: number; description: string;
  occurredAt: string; categoryId: string | null; categoryName: string | null; categoryColor: string | null;
  walletName: string | null; currency: string | null; localDate: string;
};
type LedgerDay = { date: string; incomeMinor: number; expenseMinor: number; netMinor: number; count: number };
type LedgerData = { month: string; incomeMinor: number; expenseMinor: number; netMinor: number; days: LedgerDay[]; transactions: LedgerEntry[]; truncated: boolean };

const money = (minor: number, currency = 'BDT') => new Intl.NumberFormat('en-BD', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
const monthTitle = (key: string) => new Date(key + '-01T12:00:00+06:00').toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka', month: 'long', year: 'numeric' });
const dayTitle = (key: string) => new Date(key + 'T12:00:00+06:00').toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

export function IncomeExpenseView({ workspaceId, onAdd }: { workspaceId: string; onAdd: () => void }) {
  const [month, setMonth] = useState(() => dhakaMonthStart().slice(0, 7));
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily');
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'income' | 'expense'>('all');
  const [expandedDay, setExpandedDay] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null); setExpandedDay('');
    financeApiFetch('/api/transactions/income-expense?month=' + encodeURIComponent(month), { headers: { 'x-workspace-id': workspaceId } })
      .then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not load ledger.'); return payload as LedgerData; })
      .then(payload => { if (active) { setData(payload); setExpandedDay(payload.days[0]?.date || ''); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load ledger.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, month, reload]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const entry of data?.transactions || []) {
      const rows = map.get(entry.localDate) || [];
      rows.push(entry); map.set(entry.localDate, rows);
    }
    return map;
  }, [data]);
  const visibleEntries = (date: string) => (entriesByDay.get(date) || []).filter(entry =>
    (type === 'all' || entry.transactionType === type) &&
    (entry.description + ' ' + (entry.categoryName || '') + ' ' + (entry.walletName || '')).toLowerCase().includes(query.toLowerCase())
  );
  function moveMonth(delta: number) {
    const [year, monthNumber] = month.split('-').map(Number);
    setMonth(shiftMonthStart(year + '-' + String(monthNumber).padStart(2, '0') + '-01', delta).slice(0, 7));
  }
  const dayCount = data?.days.length || 0;

  return <div className="page-stack income-expense-page">
    <section className="page-intro">
      <div><p className="eyebrow">YOUR MONEY, BY THE DAY</p><h1>Income & Expense<span>.</span></h1><p className="intro-copy">A clear ledger of what came in, what went out, and what remained.</p></div>
      <button className="primary-btn intro-action" type="button" onClick={onAdd}><Plus size={17}/> Add transaction</button>
    </section>

    <section className="surface-card ie-ledger-card">
      <div className="ie-month-nav">
        <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ArrowLeft size={18}/></button>
        <div><CalendarDays size={17}/><strong>{monthTitle(month)}</strong></div>
        <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} disabled={month >= dhakaMonthStart().slice(0, 7)}><ArrowRight size={18}/></button>
        <button className="ie-today-btn" type="button" onClick={() => setMonth(dhakaMonthStart().slice(0, 7))}>This month</button>
      </div>

      <div className="ie-period-tabs" role="tablist" aria-label="Ledger view">
        <button type="button" role="tab" aria-selected={mode === 'daily'} className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>Daily</button>
        <button type="button" role="tab" aria-selected={mode === 'monthly'} className={mode === 'monthly' ? 'active' : ''} onClick={() => setMode('monthly')}>Monthly</button>
      </div>

      {loading ? <div className="ie-state"><RefreshCw className="ie-spin" size={18}/> Loading your ledger…</div> : error ? <div className="ie-state ie-error">{error}<button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></div> : data && <>
        <div className="ie-total-grid">
          <article><span><ArrowDownLeft size={15}/> Total income</span><strong className="ie-income">{money(data.incomeMinor)}</strong></article>
          <article><span><ArrowUpRight size={15}/> Total expenses</span><strong className="ie-expense">{money(data.expenseMinor)}</strong></article>
          <article><span>Net change</span><strong className={data.netMinor >= 0 ? 'ie-income' : 'ie-expense'}>{money(data.netMinor)}</strong></article>
        </div>

        <div className="ie-tools-row">
          <div className="ie-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search description, category or wallet"/></div>
          <div className="ie-type-filter">{(['all', 'income', 'expense'] as const).map(value => <button key={value} type="button" className={type === value ? 'active' : ''} onClick={() => setType(value)}>{value === 'all' ? 'All' : value === 'income' ? 'Income' : 'Expenses'}</button>)}</div>
        </div>

        {mode === 'monthly' && <div className="ie-month-summary">
          <div><span>Days with activity</span><b>{dayCount}</b></div>
          <div><span>Avg. expense per active day</span><b>{money(dayCount ? Math.round(data.expenseMinor / dayCount) : 0)}</b></div>
          <div><span>Transactions recorded</span><b>{data.transactions.length}{data.truncated ? '+' : ''}</b></div>
        </div>}

        <div className="ie-day-list">
          {data.days.length === 0 ? <div className="ie-empty"><CalendarDays size={25}/><b>No transactions this month</b><span>Income and expenses will appear here when recorded.</span><button className="secondary-btn" type="button" onClick={onAdd}><Plus size={15}/> Add first transaction</button></div> :
            data.days.map(day => {
              const open = expandedDay === day.date;
              const entries = visibleEntries(day.date);
              return <section className={'ie-day-block' + (open ? ' is-open' : '')} key={day.date}>
                <button type="button" className="ie-day-heading" onClick={() => setExpandedDay(open ? '' : day.date)} aria-expanded={open}>
                  <span className="ie-day-date"><b>{day.date.slice(-2)}</b><span><strong>{dayTitle(day.date)}</strong><small>{day.count} {day.count === 1 ? 'transaction' : 'transactions'}</small></span></span>
                  <span className="ie-day-figures"><small className="ie-income">+{money(day.incomeMinor)}</small><small className="ie-expense">−{money(day.expenseMinor)}</small><b className={day.netMinor >= 0 ? 'ie-income' : 'ie-expense'}>{money(day.netMinor)}</b></span>
                  {open ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}
                </button>
                {open && <div className="ie-day-details">
                  {entries.length ? entries.map(entry => <article className="ie-entry" key={entry.id}>
                    <span className={'ie-entry-icon ' + entry.transactionType}>{entry.transactionType === 'income' ? <ArrowDownLeft size={16}/> : <ArrowUpRight size={16}/>}</span>
                    <span className="ie-entry-info"><b>{entry.description}</b><small><i style={{ background: entry.categoryColor || 'var(--muted)' }}/> {entry.categoryName || 'Uncategorized'} · {entry.walletName || 'Wallet'}</small></span>
                    <strong className={entry.transactionType === 'income' ? 'ie-income' : 'ie-expense'}>{entry.transactionType === 'income' ? '+' : '−'}{money(entry.amountMinor, entry.currency || 'BDT')}</strong>
                  </article>) : <p className="ie-no-match">No transactions match the current search/filter for this day.</p>}
                  <div className="ie-day-total"><span>Day total</span><span className="ie-income">In {money(day.incomeMinor)}</span><span className="ie-expense">Out {money(day.expenseMinor)}</span><b className={day.netMinor >= 0 ? 'ie-income' : 'ie-expense'}>Net {money(day.netMinor)}</b></div>
                </div>}
              </section>;
            })
          }
        </div>
        {data.truncated && <p className="ie-truncated-note">Showing the latest 2,000 transactions for this month. Monthly totals and daily totals still include every recorded transaction.</p>}
      </>}
    </section>
    <p className="ie-footnote">Transfers between your own wallets are excluded from income and expenses. Opening-balance adjustments are excluded too. The net figure is this period’s income minus expenses, not your wallet balance.</p>
  </div>;
}
