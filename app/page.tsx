'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Bell, ChevronRight, CreditCard,
  Home, Moon, Plus, Receipt, Search, Sun, WalletCards, X, ArrowRight,
  CircleHelp, Sparkles, TrendingUp, ShieldCheck, Menu, Landmark, Activity,
  HandCoins, Settings as SettingsIcon,
} from 'lucide-react';
import { useUser, UserButton } from '@clerk/nextjs';
import { FiscusView, SettingsView } from '@/components/monetra/module-views';
import { DueDebtView } from '@/components/monetra/due-debt-view';
import { FiscusMark } from '@/components/monetra/fiscus-mark';
import { FloatingCalculator } from '@/components/monetra/floating-calculator';
import { FinancialIntelligenceView } from '@/components/monetra/financial-intelligence-view';

type WalletType = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'savings' | 'debit_card' | 'credit_card' | 'custom';
type TransactionType = 'income' | 'expense' | 'transfer';
type Wallet = { id: string; name: string; walletType: WalletType; currentBalanceMinor: number; currency: string; status: string };
type Category = { id: string; name: string; categoryType: 'income' | 'expense'; color: string };
type Transaction = { id: string; transactionType: TransactionType; walletId: string; destinationWalletId: string | null; amountMinor: number; description: string; occurredAt: string; categoryId: string | null };
type FinanceSummary = { incomeMinor: number; expenseMinor: number; categorySpend: { categoryId: string | null; totalMinor: number }[] };
type Organization = { id: string; name: string; type: 'personal' | 'family' | 'business'; role: 'owner' | 'administrator' | 'editor' | 'viewer' };
type View = 'overview' | 'wallets' | 'transactions' | 'intelligence' | 'due-debt' | 'vault' | 'settings';

const walletLabels: Record<WalletType, string> = {
  cash: 'Cash', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank',
  savings: 'Savings', debit_card: 'Debit card', credit_card: 'Credit card', custom: 'Custom',
};
const money = (minor: number, currency = 'BDT') =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-BD', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

export default function HomePage() {
  const { user, isLoaded } = useUser();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState('');
  const [showOrganizationForm, setShowOrganizationForm] = useState(false);
  const [showInvitationForm, setShowInvitationForm] = useState(false);
  const [showMembersForm, setShowMembersForm] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [summary, setSummary] = useState<FinanceSummary>({ incomeMinor: 0, expenseMinor: 0, categorySpend: [] });
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('overview');
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('monetra-theme');
    setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('monetra-theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  useEffect(() => {
    if (isLoaded && user) void initializeWorkspace();
  }, [isLoaded, user?.id]);

  async function initializeWorkspace() {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/organizations');
      if (!response.ok) throw new Error('Could not load organizations');
      const rows: Organization[] = await response.json();
      setOrganizations(rows);
      const selected = rows[0];
      if (!selected) throw new Error('No personal organization is available');
      setActiveOrganizationId(selected.id);
      await loadFinanceData(selected.id);
    } catch {
      setLoadError('We couldn’t open your finance workspace. Please retry in a moment.');
      setLoading(false);
    }
  }

  async function loadFinanceData(organizationId = activeOrganizationId) {
    setLoading(true);
    setLoadError('');
    try {
      const now = new Date();
      const localMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const localNextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const summaryUrl = `/api/transactions/summary?from=${encodeURIComponent(localMonthStart.toISOString())}&to=${encodeURIComponent(localNextMonthStart.toISOString())}`;
      const headers: Record<string, string> = {};
      if (organizationId) headers['x-organization-id'] = organizationId;
      const [walletRes, categoryRes, transactionRes, summaryRes] = await Promise.all([
        fetch('/api/wallets', { headers }), fetch('/api/categories', { headers }), fetch('/api/transactions?limit=50&offset=0', { headers }), fetch(summaryUrl, { headers }),
      ]);
      if (!walletRes.ok || !categoryRes.ok || !transactionRes.ok || !summaryRes.ok) throw new Error('Some finance data could not be loaded.');
      const [walletData, categoryData, transactionData, summaryData] = await Promise.all([
        walletRes.json(), categoryRes.json(), transactionRes.json(), summaryRes.json(),
      ]);
      setWallets(walletData); setCategories(categoryData); setTransactions(transactionData.slice(0, 50)); setHasMoreTransactions(transactionData.length > 50); setSummary(summaryData);
    } catch {
      setLoadError('We couldn’t sync your finance data. Check your connection and try again.');
    } finally { setLoading(false); }
  }

  async function loadMoreTransactions() {
    try {
      const response = await fetch(`/api/transactions?limit=50&offset=${transactions.length}`, { headers: { 'x-organization-id': activeOrganizationId } });
      if (!response.ok) throw new Error('Unable to load older transactions');
      const rows: Transaction[] = await response.json();
      setTransactions((current) => [...current, ...rows.slice(0, 50)]);
      setHasMoreTransactions(rows.length > 50);
    } catch {
      setNotice('Could not load older transactions. Please try again.');
    }
  }

  const totalAssets = wallets.filter((w) => w.walletType !== 'credit_card').reduce((sum, w) => sum + Number(w.currentBalanceMinor), 0);
  const totalLiabilities = wallets.filter((w) => w.walletType === 'credit_card').reduce((sum, w) => sum + Number(w.currentBalanceMinor), 0);
  const netWorth = totalAssets - totalLiabilities;
  const monthlyIncome = summary.incomeMinor;
  const monthlyExpense = summary.expenseMinor;
  const categorySpend = useMemo(() => summary.categorySpend.map((entry) => {
    const category = categories.find((item) => item.id === entry.categoryId);
    return { id: entry.categoryId || 'uncategorized', name: category?.name || 'Uncategorized', color: category?.color || '#78928b', total: entry.totalMinor };
  }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total), [categories, summary]);
  const donutTotal = categorySpend.reduce((sum, c) => sum + c.total, 0);
  const firstName = user?.firstName || 'there';
  const activeOrganization = organizations.find((organization) => organization.id === activeOrganizationId);

  if (!isLoaded || loading) return <div className="loading-screen"><div className="loading-mark">M</div><p>Preparing your money space</p><span className="loading-line" /></div>;

  const navItems = [
    { key: 'overview' as const, label: 'Overview', icon: Home },
    { key: 'wallets' as const, label: 'Wallets', icon: WalletCards },
    { key: 'transactions' as const, label: 'Transactions', icon: Receipt },
    { key: 'intelligence' as const, label: 'Financial Radar', icon: Activity },
    { key: 'due-debt' as const, label: 'Due & Debt', icon: HandCoins },
    { key: 'vault' as const, label: 'Fiscus A.I.', icon: FiscusMark },
    { key: 'settings' as const, label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="/" aria-label="Monetra home">
          <span className="brand-mark">M</span><span className="brand-name">monetra<span>.</span><small>PERSONAL FINANCE</small></span>
        </a>
        <p className="side-label">WORKSPACE</p>
        <nav className="side-nav">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`side-nav-item ${activeView === key ? 'active' : ''}`} onClick={() => setActiveView(key)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{activeView === key && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="vault-note"><div className="vault-note-icon"><ShieldCheck size={17} /></div><div><b>Your data, protected.</b><span>Private financial workspace</span></div></div>
          <div className="sidebar-user"><UserButton afterSignOutUrl="/" /><div className="min-w-0"><b className="truncate">{user?.fullName || firstName}</b><span>{activeOrganization?.name || 'Personal account'}</span></div></div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-context"><span className="status-dot" /> YOUR FINANCIAL OVERVIEW <span className="topbar-divider">/</span> <span>{navItems.find((item) => item.key === activeView)?.label || activeView}</span></div>
          <div className="topbar-actions">
            <div className="organization-switcher">
              <select aria-label="Switch financial space" value={activeOrganizationId} onChange={(event) => { const id = event.target.value; setActiveOrganizationId(id); void loadFinanceData(id); }}>
                {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowOrganizationForm(true)}>+ Space</button>

            </div>
            <button className="icon-btn" onClick={() => setDark((v) => !v)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-btn" aria-label="Help"><CircleHelp size={18} /></button>
            <div className="topbar-user"><UserButton afterSignOutUrl="/" /></div>
          </div>
        </header>

        <div className="content-wrap">
          {notice && <div className="notice-bar"><span className="status-dot" />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
          {loadError && <div className="error-bar">{loadError}<button onClick={() => void (activeOrganizationId ? loadFinanceData() : initializeWorkspace())}>Retry</button></div>}

          {activeView === 'overview' && (
            <div className="page-stack">
              <section className="page-intro">
                <div><p className="eyebrow">{new Intl.DateTimeFormat('en-BD', { weekday: 'long' }).format(new Date()).toUpperCase()}, YOUR MONEY CHECK-IN</p><h1>Good to see you, {firstName}<span>.</span></h1><p className="intro-copy">Here’s what’s happening with your money.</p></div>
                <button className="primary-btn intro-action" onClick={() => setShowTransactionForm(true)}><Plus size={17} /> New transaction</button>
              </section>

              <section className="balance-card">
                <div className="balance-card-top"><div><span className="balance-kicker">TOTAL NET WORTH</span><span className="balance-period"><span className="status-dot light" /> LIVE BALANCE</span></div><span className="balance-symbol">৳</span></div>
                <div className="balance-value">{money(netWorth)}</div>
                <p className="balance-caption">What you own, minus what you owe.</p>
                <div className="balance-divider" />
                <div className="balance-breakdown">
                  <div><span className="breakdown-icon positive"><ArrowDownLeft size={15} /></span><span><small>Total assets</small><b>{money(totalAssets)}</b></span></div>
                  <div><span className="breakdown-icon negative"><ArrowUpRight size={15} /></span><span><small>Liabilities</small><b>{money(totalLiabilities)}</b></span></div>
                  <div className="balance-actions"><button onClick={() => setShowWalletForm(true)}><Plus size={15} /> Add wallet</button><button onClick={() => setShowTransactionForm(true)}><Plus size={15} /> Add activity</button></div>
                </div>
                <div className="balance-orbit orbit-one" /><div className="balance-orbit orbit-two" />
              </section>

              <section className="metric-grid">
                <article className="metric-card"><div className="metric-top"><span className="metric-icon income"><ArrowDownLeft size={17} /></span><span className="metric-period">THIS MONTH</span></div><p className="metric-label">Money in</p><p className="metric-value">{money(monthlyIncome)}</p><p className="metric-foot">Income recorded this month</p></article>
                <article className="metric-card"><div className="metric-top"><span className="metric-icon expense"><ArrowUpRight size={17} /></span><span className="metric-period">THIS MONTH</span></div><p className="metric-label">Money out</p><p className="metric-value">{money(monthlyExpense)}</p><p className="metric-foot">Expenses recorded this month</p></article>
                <article className="metric-card metric-card-accent"><div className="metric-top"><span className="metric-icon net"><TrendingUp size={17} /></span><span className="metric-period">THIS MONTH</span></div><p className="metric-label">Net cash flow</p><p className="metric-value">{money(monthlyIncome - monthlyExpense)}</p><p className="metric-foot">Income minus expenses</p></article>
              </section>

              <div className="dashboard-grid">
                <section className="surface-card spending-card">
                  <div className="section-heading"><div><p className="eyebrow">WHERE IT GOES</p><h2>Spending breakdown</h2><p className="section-subtitle">Your expense categories this month.</p></div><span className="section-icon"><BarChart3 size={18} /></span></div>
                  {categorySpend.length === 0 ? <EmptyState icon={<BarChart3 size={22} />} title="Your chart starts here" text="Record an expense with a category to see where your money goes." /> : (
                    <div className="spending-content">
                      <div className="donut-wrap"><div className="donut-chart" style={{ background: `conic-gradient(${categorySpend.map((c, i) => `${c.color} ${categorySpend.slice(0, i).reduce((s, x) => s + x.total, 0) / donutTotal * 100}% ${categorySpend.slice(0, i + 1).reduce((s, x) => s + x.total, 0) / donutTotal * 100}%`).join(', ')})` }}><div className="donut-hole"><b>{money(donutTotal).replace('BDT', '৳')}</b><span>TOTAL SPENT</span></div></div></div>
                      <div className="spending-legend">{categorySpend.slice(0, 5).map((c) => <div className="legend-row" key={c.id}><span className="legend-name"><i style={{ background: c.color }} />{c.name}</span><b>{money(c.total)}</b></div>)}</div>
                    </div>
                  )}
                </section>

                <section className="surface-card wallet-preview">
                  <div className="section-heading"><div><p className="eyebrow">YOUR ACCOUNTS</p><h2>Wallets</h2><p className="section-subtitle">{wallets.length} active account{wallets.length === 1 ? '' : 's'}</p></div><button className="text-action" onClick={() => setActiveView('wallets')}>View all <ArrowRight size={14} /></button></div>
                  {wallets.length === 0 ? <EmptyState icon={<WalletCards size={22} />} title="No wallets yet" text="Add your cash, bank, or mobile wallet to get started." action="Add a wallet" onClick={() => setShowWalletForm(true)} /> : <div className="wallet-preview-list">{wallets.slice(0, 4).map((w) => <div className="wallet-preview-row" key={w.id}><span className="wallet-mini-icon">{w.walletType === 'bank' ? <Landmark size={17} /> : w.walletType === 'credit_card' || w.walletType === 'debit_card' ? <CreditCard size={17} /> : <WalletCards size={17} />}</span><span className="wallet-preview-name"><b>{w.name}</b><small>{walletLabels[w.walletType]}</small></span><b className={w.walletType === 'credit_card' ? 'liability-text' : ''}>{w.walletType === 'credit_card' ? '−' : ''}{money(Math.abs(Number(w.currentBalanceMinor)), w.currency)}</b></div>)}</div>}
                  {wallets.length > 0 && <button className="add-wallet-row" onClick={() => setShowWalletForm(true)}><Plus size={15} /> Add another wallet</button>}
                </section>
              </div>

              <section className="surface-card activity-card">
                <div className="section-heading"><div><p className="eyebrow">THE LATEST</p><h2>Recent activity</h2><p className="section-subtitle">A clear view of your latest money movement.</p></div><button className="text-action" onClick={() => setActiveView('transactions')}>All transactions <ArrowRight size={14} /></button></div>
                {transactions.length === 0 ? <EmptyState icon={<Receipt size={22} />} title="A clean slate" text="Your income, expenses, and transfers will show up here." action="Record your first activity" onClick={() => setShowTransactionForm(true)} /> : <div className="transaction-list">{transactions.slice(0, 6).map((t) => <TransactionRow key={t.id} transaction={t} wallets={wallets} categories={categories} />)}</div>}
              </section>
              <footer className="page-footer"><span>MONETRA · YOUR MONEY, UNDER COMMAND.</span><span><ShieldCheck size={13} /> PRIVATE BY DESIGN</span></footer>
            </div>
          )}

          {activeView === 'wallets' && <WalletsView wallets={wallets} onAdd={() => setShowWalletForm(true)} />}
          {activeView === 'transactions' && <TransactionsView transactions={transactions} wallets={wallets} categories={categories} onAdd={() => setShowTransactionForm(true)} onLoadMore={loadMoreTransactions} hasMore={hasMoreTransactions} />}
          {activeView === 'intelligence' && <FinancialIntelligenceView wallets={wallets} transactions={transactions} monthlyIncomeMinor={monthlyIncome} monthlyExpenseMinor={monthlyExpense} />}
          {activeView === 'due-debt' && <DueDebtView />}
          {activeView === 'vault' && <FiscusView />}
          {activeView === 'settings' && <SettingsView dark={dark} onToggleTheme={() => setDark((current) => !current)} />}
        </div>
      </div>

      <nav className="mobile-nav">{navItems.map(({ key, label, icon: Icon }) => <button key={key} className={activeView === key ? 'active' : ''} onClick={() => setActiveView(key)}><Icon size={20} /><span>{label}</span></button>)}</nav>
      {showWalletForm && <WalletModal organizationId={activeOrganizationId} onClose={() => setShowWalletForm(false)} onSaved={async (message) => { setShowWalletForm(false); setNotice(message); await loadFinanceData(); }} />}
      {showTransactionForm && <TransactionModal organizationId={activeOrganizationId} wallets={wallets} categories={categories} onClose={() => setShowTransactionForm(false)} onSaved={async (message) => { setShowTransactionForm(false); setNotice(message); await loadFinanceData(); }} />}
      {showOrganizationForm && <OrganizationModal onClose={() => setShowOrganizationForm(false)} onSaved={async (organization) => { setOrganizations((current) => [...current, organization]); setShowOrganizationForm(false); setActiveOrganizationId(organization.id); setNotice(`${organization.name} space created.`); await loadFinanceData(organization.id); }} />}
      {showInvitationForm && activeOrganization && <InvitationModal organizationId={activeOrganization.id} canInviteAdministrators={activeOrganization.role === 'owner'} onClose={() => setShowInvitationForm(false)} />}
      {showMembersForm && activeOrganization && <OrganizationMembersModal organizationId={activeOrganization.id} currentRole={activeOrganization.role} onClose={() => setShowMembersForm(false)} />}
      <FloatingCalculator />
    </main>
  );
}

function EmptyState({ icon, title, text, action, onClick }: { icon: React.ReactNode; title: string; text: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action && onClick && <button className="text-action" onClick={onClick}>{action}<ChevronRight size={15} /></button>}</div>;
}

function TransactionRow({ transaction, wallets, categories }: { transaction: Transaction; wallets: Wallet[]; categories: Category[] }) {
  const wallet = wallets.find((w) => w.id === transaction.walletId);
  const category = categories.find((c) => c.id === transaction.categoryId);
  const positive = transaction.transactionType === 'income';
  const transfer = transaction.transactionType === 'transfer';
  return <div className="transaction-row"><span className={`transaction-icon ${positive ? 'income' : transfer ? 'transfer' : 'expense'}`}>{positive ? <ArrowDownLeft size={18} /> : transfer ? <ArrowRight size={18} /> : <ArrowUpRight size={18} />}</span><span className="transaction-main"><b>{transaction.description}</b><small>{category?.name || transaction.transactionType} <i /> {wallet?.name || 'Wallet'} {transfer && transaction.destinationWalletId ? <> <i /> To {wallets.find((w) => w.id === transaction.destinationWalletId)?.name || 'another wallet'}</> : null} <i /> {dateLabel(transaction.occurredAt)}</small></span><b className={`transaction-amount ${positive ? 'positive' : transfer ? 'neutral' : ''}`}>{positive ? '+' : transfer ? '' : '−'}{money(Number(transaction.amountMinor), wallet?.currency || 'BDT')}</b></div>;
}

function WalletsView({ wallets, onAdd }: { wallets: Wallet[]; onAdd: () => void }) {
  return <div className="page-stack"><section className="page-intro"><div><p className="eyebrow">YOUR MONEY, ORGANIZED</p><h1>Wallets<span>.</span></h1><p className="intro-copy">Every account, one clear picture.</p></div><button className="primary-btn intro-action" onClick={onAdd}><Plus size={17} /> Add wallet</button></section>
    {wallets.length === 0 ? <section className="surface-card"><EmptyState icon={<WalletCards size={22} />} title="No wallets yet" text="Start with your everyday cash, bank account, or a card." action="Add your first wallet" onClick={onAdd} /></section> : <div className="wallet-grid">{wallets.map((wallet) => <article key={wallet.id} className={`wallet-card ${wallet.walletType === 'credit_card' ? 'credit-wallet' : ''}`}><div className="wallet-card-top"><span className="wallet-card-icon">{wallet.walletType === 'bank' ? <Landmark size={20} /> : wallet.walletType.includes('card') ? <CreditCard size={20} /> : <WalletCards size={20} />}</span><span className="wallet-status"><i />{wallet.status || 'Active'}</span></div><h3>{wallet.name}</h3><p>{walletLabels[wallet.walletType]}</p><div className="wallet-card-balance">{wallet.walletType === 'credit_card' ? '−' : ''}{money(Math.abs(Number(wallet.currentBalanceMinor)), wallet.currency)}</div><small>{wallet.walletType === 'credit_card' ? 'Outstanding liability' : 'Available balance'}</small></article>)}</div>}
  </div>;
}

function TransactionsView({ transactions, wallets, categories, onAdd, onLoadMore, hasMore }: { transactions: Transaction[]; wallets: Wallet[]; categories: Category[]; onAdd: () => void; onLoadMore: () => Promise<void>; hasMore: boolean }) {
  const [query, setQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<'all' | TransactionType>('all');
  const filtered = transactions.filter((t) => t.description.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || t.transactionType === filter));
  return <div className="page-stack"><section className="page-intro"><div><p className="eyebrow">YOUR FINANCIAL HISTORY</p><h1>Transactions<span>.</span></h1><p className="intro-copy">Every movement, accounted for.</p></div><button className="primary-btn intro-action" onClick={onAdd}><Plus size={17} /> New transaction</button></section><section className="surface-card ledger-card"><div className="ledger-toolbar"><div className="search-wrap"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transactions..." /></div><div className="filter-tabs">{(['all', 'income', 'expense', 'transfer'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div></div>{filtered.length === 0 ? <EmptyState icon={<Search size={22} />} title="Nothing matches" text="Try a different search or filter." /> : <div className="transaction-list">{filtered.map((t) => <TransactionRow key={t.id} transaction={t} wallets={wallets} categories={categories} />)}</div>}{hasMore && query.trim() === '' && filter === 'all' && <button className="load-more-btn" disabled={loadingMore} onClick={async () => { setLoadingMore(true); await onLoadMore(); setLoadingMore(false); }}>{loadingMore ? 'Loading older activity…' : 'Load older transactions'} <ChevronRight size={15} /></button>}</section></div>;
}

function WalletModal({ organizationId, onClose, onSaved }: { organizationId: string; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [name, setName] = useState(''); const [type, setType] = useState<WalletType>('cash'); const [opening, setOpening] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const amount = Math.round(Number(opening || 0) * 100);
      const res = await fetch('/api/wallets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId }, body: JSON.stringify({ name, walletType: type, currency: 'BDT', openingBalanceMinor: amount }) });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || 'Could not add this wallet.'); }
      else await onSaved('Wallet added. Your balance is now synced.');
    } catch { setError('Connection issue. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Add a wallet" subtitle="Bring another account into your overview." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field-label">Wallet name<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Everyday cash" required /></label><label className="field-label">Wallet type<select className="field" value={type} onChange={(e) => setType(e.target.value as WalletType)}>{Object.entries(walletLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field-label">Opening balance<input className="field" type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></label>{type === 'credit_card' && <p className="form-hint">Credit cards are liabilities. Their balance reduces net worth and is not counted as available money.</p>}{error && <p className="form-error">{error}</p>}<button className="primary-btn w-full" disabled={busy}>{busy ? 'Saving...' : 'Create wallet'}</button></form></Modal>;
}

function TransactionModal({ organizationId, wallets, categories, onClose, onSaved }: { organizationId: string; wallets: Wallet[]; categories: Category[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [type, setType] = useState<TransactionType>('expense'); const [wallet, setWallet] = useState(wallets[0]?.id || ''); const [destination, setDestination] = useState(wallets[1]?.id || ''); const [category, setCategory] = useState(categories.find((c) => c.categoryType === 'expense')?.id || ''); const [amount, setAmount] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const amountMinor = Math.round(Number(amount) * 100);
      const endpoint = type === 'transfer' ? '/api/transfers' : '/api/transactions';
      const body = type === 'transfer' ? { walletId: wallet, destinationWalletId: destination, amountMinor, description } : { walletId: wallet, transactionType: type, categoryId: category || null, amountMinor, description };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId }, body: JSON.stringify(body) });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || 'Could not post this activity. Check the details and try again.'); }
      else await onSaved('Activity posted. Your balances are up to date.');
    } catch { setError('Connection issue. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Record activity" subtitle="Keep your money movement up to date." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field-label">Activity type<select className="field" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>{(['income', 'expense', 'transfer'] as TransactionType[]).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><label className="field-label">{type === 'transfer' ? 'From wallet' : 'Wallet'}<select className="field" value={wallet} onChange={(e) => setWallet(e.target.value)} required>{wallets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{type === 'transfer' && <label className="field-label">To wallet<select className="field" value={destination} onChange={(e) => setDestination(e.target.value)} required>{wallets.filter((item) => item.id !== wallet).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{type !== 'transfer' && <label className="field-label">Category<select className="field" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Uncategorized</option>{categories.filter((item) => item.categoryType === (type === 'income' ? 'income' : 'expense')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label className="field-label">Amount<input className="field" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></label><label className="field-label">Description<input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-btn w-full" disabled={busy || wallets.length === 0}>{busy ? 'Posting...' : 'Post activity'}</button></form></Modal>;
}

function OrganizationMembersModal({ organizationId, currentRole, onClose }: { organizationId: string; currentRole: Organization['role']; onClose: () => void }) {
  type Member = { id: string; userId: string; role: Organization['role']; joinedAt: string };
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState('');

  async function loadMembers() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/members', { headers: { 'x-organization-id': organizationId } });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || 'Could not load members.');
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadMembers(); }, [organizationId]);

  async function updateMember(member: Member, role: Organization['role']) {
    setWorkingId(member.id);
    setError('');
    try {
      const response = await fetch(`/api/organizations/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId },
        body: JSON.stringify({ role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update this member.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this member.');
    } finally {
      setWorkingId('');
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm('Remove this member from the organization? They will lose access to its financial data.')) return;
    setWorkingId(member.id);
    setError('');
    try {
      const response = await fetch(`/api/organizations/members/${member.id}`, {
        method: 'DELETE',
        headers: { 'x-organization-id': organizationId },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not remove this member.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this member.');
    } finally {
      setWorkingId('');
    }
  }

  return <Modal title="Workspace team" subtitle="Control who can see and manage this space." onClose={onClose}>
    <div className="modal-form">
      {busy ? <p className="form-hint">Loading members…</p> : members.map((member) => {
        const canManage = member.role !== 'owner' && (currentRole === 'owner' || member.role !== 'administrator');
        return <div className="member-row" key={member.id}>
          <div className="member-identity"><b>{member.userId.slice(0, 15)}{member.userId.length > 15 ? '…' : ''}</b><small>{member.role}</small></div>
          {member.role === 'owner' ? <span className="member-role-label">Owner</span> : <select className="field member-role-select" aria-label="Member role" value={member.role} disabled={!canManage || workingId === member.id} onChange={(event) => void updateMember(member, event.target.value as Organization['role'])}>
            {currentRole === 'owner' && <option value="administrator">Administrator</option>}
            <option value="editor">Editor</option><option value="viewer">Viewer</option>
          </select>}
          {canManage && <button className="member-remove" type="button" disabled={workingId === member.id} onClick={() => void removeMember(member)}>Remove</button>}
        </div>;
      })}
      {error && <p className="form-error">{error}</p>}
      <button className="text-action" type="button" onClick={onClose}>Done</button>
    </div>
  </Modal>;
}

function InvitationModal({ organizationId, canInviteAdministrators, onClose }: { organizationId: string; canInviteAdministrators: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'administrator' | 'editor' | 'viewer'>('editor');
  const [inviteUrl, setInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInviteUrl('');
    try {
      const response = await fetch('/api/organizations/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId },
        body: JSON.stringify({ email, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not create invitation.');
        return;
      }
      setInviteUrl(data.inviteUrl);
    } catch {
      setError('Connection issue. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError('Could not copy automatically. Select and copy the invitation link.');
    }
  }

  return <Modal title="Invite a member" subtitle="Share access without mixing private financial spaces." onClose={onClose}>
    {!inviteUrl ? <form className="modal-form" onSubmit={submit}>
      <label className="field-label">Email address<input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" required /></label>
      <label className="field-label">Access role<select className="field" value={role} onChange={(event) => setRole(event.target.value as 'administrator' | 'editor' | 'viewer')}><option value="editor">Editor — can manage finances</option><option value="viewer">Viewer — read only</option>{canInviteAdministrators && <option value="administrator">Administrator — manage workspace</option>}</select></label>
      <p className="form-hint">The invitation link is valid for 7 days. The invited person must sign in with this exact verified email. No email is sent automatically yet.</p>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-btn w-full" disabled={busy}>{busy ? 'Creating link…' : 'Generate invitation link'}</button>
    </form> : <div className="modal-form">
      <p className="form-hint">Invitation created for <b>{email}</b>. Share this link with them; it expires in 7 days.</p>
      <input className="field" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
      <button className="primary-btn w-full" type="button" onClick={copyInvite}>{copied ? 'Copied' : 'Copy invitation link'}</button>
      <button className="text-action" type="button" onClick={onClose}>Done</button>
    </div>}
  </Modal>;
}

function OrganizationModal({ onClose, onSaved }: { onClose: () => void; onSaved: (organization: Organization) => Promise<void> }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'family' | 'business'>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not create this space.');
        return;
      }
      await onSaved(data as Organization);
    } catch {
      setError('Connection issue. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Create a space" subtitle="Keep personal, family, and business money separate." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field-label">Space name<input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Family finances" maxLength={80} required /></label><label className="field-label">Space type<select className="field" value={type} onChange={(event) => setType(event.target.value as 'family' | 'business')}><option value="family">Family</option><option value="business">Business</option></select></label>{error && <p className="form-error">{error}</p>}<button className="primary-btn w-full" disabled={busy}>{busy ? 'Creating…' : 'Create space'}</button></form></Modal>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-panel"><div className="modal-heading"><div><p className="eyebrow">MONETRA WORKSPACE</p><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>;
}
