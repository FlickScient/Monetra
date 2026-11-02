'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronRight,
  CreditCard,
  DollarSign,
  Landmark,
  Menu,
  Moon,
  Plus,
  Receipt,
  Search,
  Sparkles,
  Sun,
  WalletCards,
  X,
} from 'lucide-react';
import { useUser, UserButton } from '@clerk/nextjs';

type WalletType = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'savings' | 'debit_card' | 'credit_card' | 'custom';
type TransactionType = 'income' | 'expense' | 'transfer';
type Wallet = { id: string; name: string; walletType: WalletType; currentBalanceMinor: number; currency: string; status: string };
type Category = { id: string; name: string; categoryType: 'income' | 'expense'; color: string };
type Transaction = { id: string; transactionType: TransactionType; walletId: string; destinationWalletId: string | null; amountMinor: number; description: string; occurredAt: string; categoryId: string | null };

const walletLabels: Record<WalletType, string> = {
  cash: 'Cash', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank', savings: 'Savings', debit_card: 'Debit card', credit_card: 'Credit card', custom: 'Custom',
};

const money = (minor: number, currency = 'BDT') => new Intl.NumberFormat('en-BD', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-BD', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

export default function Home() {
  const { user, isLoaded } = useUser();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'overview' | 'wallets' | 'transactions'>('overview');
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (isLoaded && user) loadFinanceData();
  }, [isLoaded, user]);

  async function loadFinanceData() {
    setLoading(true);
    const [walletRes, categoryRes, transactionRes] = await Promise.all([
      fetch('/api/wallets'),
      fetch('/api/categories'),
      fetch('/api/transactions'),
    ]);
    if (walletRes.ok) setWallets(await walletRes.json());
    if (categoryRes.ok) setCategories(await categoryRes.json());
    if (transactionRes.ok) setTransactions(await transactionRes.json());
    setLoading(false);
  }

  const totalAssets = wallets.filter((w) => w.walletType !== 'credit_card').reduce((sum, w) => sum + Number(w.currentBalanceMinor), 0);
  const totalLiabilities = wallets.filter((w) => w.walletType === 'credit_card').reduce((sum, w) => sum + Number(w.currentBalanceMinor), 0);
  const netWorth = totalAssets - totalLiabilities;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthlyTransactions = transactions.filter((t) => new Date(t.occurredAt) >= monthStart);
  const monthlyIncome = monthlyTransactions.filter((t) => t.transactionType === 'income').reduce((sum, t) => sum + Number(t.amountMinor), 0);
  const monthlyExpense = monthlyTransactions.filter((t) => t.transactionType === 'expense').reduce((sum, t) => sum + Number(t.amountMinor), 0);
  const categorySpend = useMemo(() => categories.map((c) => ({ ...c, total: monthlyTransactions.filter((t) => t.categoryId === c.id && t.transactionType === 'expense').reduce((sum, t) => sum + Number(t.amountMinor), 0) })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 4), [categories, monthlyTransactions]);

  if (!isLoaded || loading) return <div className="min-h-screen grid place-items-center bg-[#f6f8f6] text-[#17463f]">Loading your secure workspace...</div>;

  return (
    <main className={dark ? 'dark min-h-screen bg-[#101918] text-[#effaf5]' : 'min-h-screen bg-[#f6f8f6] text-[#19332e]'}>
      <div className="flex min-h-screen">
        <aside className={`${showMobileNav ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-30 w-72 border-r border-[#dce8e2] bg-[#fbfdfb] p-6 transition-transform dark:border-[#28403b] dark:bg-[#15201f] lg:static lg:translate-x-0`}>
          <div className="flex items-center justify-between"><Logo /><button className="lg:hidden" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={20} /></button></div>
          <p className="mt-14 px-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[#78928b]">Workspace</p>
          <nav className="mt-4 space-y-2">
            {([['overview', 'Overview', BarChart3], ['wallets', 'Wallets', WalletCards], ['transactions', 'Transactions', Receipt]] as const).map(([key, label, Icon]) => <button key={key} onClick={() => { setActiveView(key); setShowMobileNav(false); }} className={`nav-item ${activeView === key ? 'nav-item-active' : ''}`}><Icon size={18} />{label}<ChevronRight className="ml-auto" size={15} /></button>)}
          </nav>
          <div className="absolute bottom-6 left-6 right-6"><div className="mb-4 rounded-2xl bg-[#e7f5ef] p-4 text-[#175e52] dark:bg-[#173b35] dark:text-[#b8e9d6]"><Sparkles size={17} /><p className="mt-3 text-sm font-semibold">A clearer money habit starts here.</p><p className="mt-1 text-xs leading-5 opacity-80">Every record is stored securely and synced across your devices.</p></div></div>
        </aside>
        <section className="min-w-0 flex-1">
          <header className="flex h-20 items-center justify-between border-b border-[#dce8e2] bg-[#f6f8f6]/90 px-5 backdrop-blur dark:border-[#28403b] dark:bg-[#101918]/90 md:px-10"><div className="flex items-center gap-3"><button className="lg:hidden" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu /></button><div><p className="text-xs text-[#78928b]">Personal finance</p><h1 className="text-xl font-bold tracking-tight">{activeView === 'overview' ? `Good morning, ${user?.firstName || 'there'}` : activeView === 'wallets' ? 'Your wallets' : 'All transactions'}</h1></div></div><div className="flex items-center gap-2"><button className="icon-btn" onClick={() => setDark((v) => !v)} aria-label="Toggle color theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-btn"><Bell size={18} /></button><UserButton afterSignOutUrl="/" /></div></header>
          <div className="mx-auto max-w-[1440px] p-5 md:p-10">
            {notice && <div className="mb-5 rounded-xl border border-[#b6e1ce] bg-[#effbf4] px-4 py-3 text-sm text-[#176b51] dark:bg-[#173b35] dark:text-[#b8e9d6]">{notice}</div>}
            {activeView === 'overview' && <Overview totalAssets={totalAssets} totalLiabilities={totalLiabilities} netWorth={netWorth} income={monthlyIncome} expense={monthlyExpense} wallets={wallets} transactions={transactions} categories={categories} categorySpend={categorySpend} onAddTransaction={() => setShowTransactionForm(true)} onAddWallet={() => setShowWalletForm(true)} />}
            {activeView === 'wallets' && <WalletsView wallets={wallets} onAdd={() => setShowWalletForm(true)} />}
            {activeView === 'transactions' && <TransactionsView transactions={transactions} wallets={wallets} categories={categories} />}
          </div>
        </section>
      </div>
      {showWalletForm && <WalletModal onClose={() => setShowWalletForm(false)} onSaved={async (message) => { setShowWalletForm(false); setNotice(message); await loadFinanceData(); }} />}
      {showTransactionForm && <TransactionModal wallets={wallets} categories={categories} onClose={() => setShowTransactionForm(false)} onSaved={async (message) => { setShowTransactionForm(false); setNotice(message); await loadFinanceData(); }} />}
    </main>
  );
}

function Logo() { return <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#0f766e] text-white"><DollarSign size={20} /></div><span className="text-lg font-extrabold tracking-tight">MoneTra</span></div>; }

function Overview({ totalAssets, totalLiabilities, netWorth, income, expense, wallets, transactions, categories, categorySpend, onAddTransaction, onAddWallet }: { totalAssets: number; totalLiabilities: number; netWorth: number; income: number; expense: number; wallets: Wallet[]; transactions: Transaction[]; categories: Category[]; categorySpend: Array<Category & { total: number }>; onAddTransaction: () => void; onAddWallet: () => void }) {
  return <div className="space-y-7"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="eyebrow">Overview</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Your money, at a glance.</h2><p className="mt-2 text-sm text-[#78928b]">A live view built from your recorded wallets and transactions.</p></div><div className="flex gap-3"><button className="secondary-btn" onClick={onAddWallet}><Plus size={17} />Add wallet</button><button className="primary-btn" onClick={onAddTransaction}><Plus size={17} />Record activity</button></div></div><div className="grid gap-4 md:grid-cols-3"><MetricCard label="Net worth" value={money(netWorth)} tone="teal" detail="Assets minus credit card liabilities" /><MetricCard label="This month in" value={money(income)} tone="mint" detail="Income" /><MetricCard label="This month out" value={money(expense)} tone="sand" detail="Recorded expenses" /></div><div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]"><section className="panel"><div className="panel-heading"><div><h3>Wallet breakdown</h3><p>Current balances across your active wallets.</p></div></div>{wallets.length === 0 ? <EmptyState icon={<WalletCards size={22} />} title="Your wallets live here" text="Add your first cash, bank, or digital wallet to see your real balance." action="Add a wallet" onClick={onAddWallet} /> : <div className="mt-7 space-y-4">{wallets.map((wallet) => <div key={wallet.id} className="flex items-center gap-4"><div className={`wallet-icon ${wallet.walletType === 'credit_card' ? 'bg-[#fff1ed] text-[#b75235]' : 'bg-[#e6f5ef] text-[#17725f]'}`}>{wallet.walletType === 'credit_card' ? <CreditCard size={18} /> : <WalletCards size={18} />}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-bold">{wallet.name}</p><p className={`text-sm font-bold ${wallet.walletType === 'credit_card' ? 'text-[#b75235]' : ''}`}>{wallet.walletType === 'credit_card' ? '-' : ''}{money(Math.abs(Number(wallet.currentBalanceMinor)), wallet.currency)}</p></div><p className="mt-1 text-xs text-[#78928b]">{walletLabels[wallet.walletType]}</p></div></div>)}</div>}</section><section className="panel"><div className="panel-heading"><div><h3>Spending mix</h3><p>Categories this month.</p></div><BarChart3 className="text-[#78928b]" size={19} /></div>{categorySpend.length === 0 ? <EmptyState icon={<BarChart3 size={22} />} title="Your chart will grow here" text="Record an expense with a category to see your spending mix." /> : <div className="mt-7"><div className="mt-7 space-y-3">{categorySpend.map((category) => <div className="flex items-center justify-between text-sm" key={category.id}><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</span><b>{money(category.total)}</b></div>)}</div></div>}</section></div><section className="panel"><div className="panel-heading"><div><h3>Recent activity</h3><p>Your latest recorded money movement.</p></div><button className="link-btn" onClick={onAddTransaction}>Add activity <Plus size={15} /></button></div>{transactions.length === 0 ? <EmptyState icon={<Receipt size={22} />} title="Nothing recorded yet" text="Your recent income, expenses, and transfers will appear here." action="Record activity" onClick={onAddTransaction} /> : <div className="mt-4 divide-y divide-[#edf2ef]">{transactions.slice(0, 5).map((t) => <TransactionRow key={t.id} transaction={t} wallets={wallets} categories={categories} />)}</div>}</section></div>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'teal' | 'mint' | 'sand' }) { return <div className={`metric-card metric-${tone}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-[#54736b]">{label}</span><span className="metric-dot" /></div><p className="mt-6 text-3xl font-extrabold tracking-tight">{value}</p><p className="mt-2 text-xs text-[#6e8981]">{detail}</p></div>; }
function EmptyState({ icon, title, text, action, onClick }: { icon: React.ReactNode; title: string; text: string; action?: string; onClick?: () => void }) { return <div className="grid place-items-center py-12 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf4ef] text-[#0f766e]">{icon}</div><h4 className="mt-4 font-bold">{title}</h4><p className="mt-2 max-w-xs text-sm leading-6 text-[#78928b]">{text}</p>{action && onClick && <button className="link-btn mt-4" onClick={onClick}>{action}<ChevronRight size={15} /></button>}</div>; }
function TransactionRow({ transaction, wallets, categories }: { transaction: Transaction; wallets: Wallet[]; categories: Category[] }) { const wallet = wallets.find((w) => w.id === transaction.walletId); const category = categories.find((c) => c.id === transaction.categoryId); const positive = transaction.transactionType === 'income'; return <div className="flex items-center gap-4 py-4"><div className={`wallet-icon ${positive ? 'bg-[#e6f5ef] text-[#17725f]' : 'bg-[#fff4ed] text-[#b76542]'}`}>{positive ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{transaction.description}</p><p className="mt-1 text-xs text-[#78928b]">{category?.name || transaction.transactionType} · {wallet?.name || 'Wallet'} · {dateLabel(transaction.occurredAt)}</p></div><p className={`text-sm font-bold ${positive ? 'text-[#17725f]' : ''}`}>{positive ? '+' : '-'}{money(Number(transaction.amountMinor), wallet?.currency || 'BDT')}</p></div>; }

function WalletsView({ wallets, onAdd }: { wallets: Wallet[]; onAdd: () => void }) { return <div className="space-y-7"><div className="flex items-end justify-between"><div><p className="eyebrow">Accounts</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">Wallets</h2><p className="mt-2 text-sm text-[#78928b]">Keep your cash, digital money, banks, and cards visible.</p></div><button className="primary-btn" onClick={onAdd}><Plus size={17} />Add wallet</button></div>{wallets.length === 0 ? <section className="panel"><EmptyState icon={<WalletCards size={22} />} title="No wallets yet" text="Start with your everyday wallet, bank account, or a card." action="Add your first wallet" onClick={onAdd} /></section> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{wallets.map((wallet) => <div key={wallet.id} className="panel"><div className="flex items-start justify-between"><div className="wallet-icon bg-[#e6f5ef] text-[#17725f]"><WalletCards size={18} /></div><span className="rounded-full bg-[#edf5f1] px-2.5 py-1 text-[11px] font-bold text-[#5d8176]">Active</span></div><h3 className="mt-7 text-lg font-extrabold">{wallet.name}</h3><p className="mt-1 text-sm text-[#78928b]">{walletLabels[wallet.walletType]}</p><p className={`mt-7 text-3xl font-extrabold ${wallet.walletType === 'credit_card' ? 'text-[#b75235]' : ''}`}>{wallet.walletType === 'credit_card' ? '-' : ''}{money(Math.abs(Number(wallet.currentBalanceMinor)), wallet.currency)}</p><p className="mt-2 text-xs text-[#78928b]">{wallet.walletType === 'credit_card' ? 'Liability balance' : 'Current balance'}</p></div>)}</div>}</div>; }
function TransactionsView({ transactions, wallets, categories }: { transactions: Transaction[]; wallets: Wallet[]; categories: Category[] }) { const [query, setQuery] = useState(''); const filtered = transactions.filter((t) => t.description.toLowerCase().includes(query.toLowerCase())); return <div className="space-y-7"><div><p className="eyebrow">Ledger</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">Transactions</h2><p className="mt-2 text-sm text-[#78928b]">A searchable record of every posted movement.</p></div><section className="panel"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#78928b]" size={18} /><input className="field pl-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search descriptions" /></div>{filtered.length === 0 ? <EmptyState icon={<Search size={22} />} title="No matching activity" text="Try another search or record your first transaction." /> : <div className="mt-5 divide-y divide-[#edf2ef]">{filtered.map((t) => <TransactionRow key={t.id} transaction={t} wallets={wallets} categories={categories} />)}</div>}</section></div>; }

function WalletModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [name, setName] = useState(''); const [type, setType] = useState<WalletType>('cash'); const [opening, setOpening] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const amount = Math.round(Number(opening || 0) * 100);
    const res = await fetch('/api/wallets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, walletType: type, currency: 'BDT', openingBalanceMinor: amount }) });
    if (!res.ok) setError('Could not add this wallet. Please try again.'); else await onSaved('Wallet added. Your balance is now synced.');
    setBusy(false);
  }
  return <Modal title="Add a wallet" onClose={onClose}><form className="space-y-4" onSubmit={submit}><label className="field-label">Wallet name<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Everyday cash" required /></label><label className="field-label">Wallet type<select className="field" value={type} onChange={(e) => setType(e.target.value as WalletType)}>{Object.entries(walletLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field-label">Opening balance<input className="field" type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></label>{type === 'credit_card' && <p className="rounded-xl bg-[#fff4ed] px-4 py-3 text-xs leading-5 text-[#9b6046]">Credit cards are recorded as liabilities. Their balance reduces net worth and is never counted as available money.</p>}{error && <p className="text-sm text-red-600">{error}</p>}<button className="primary-btn w-full" disabled={busy}>{busy ? 'Saving...' : 'Add wallet'}</button></form></Modal>;
}

function TransactionModal({ wallets, categories, onClose, onSaved }: { wallets: Wallet[]; categories: Category[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [type, setType] = useState<TransactionType>('expense'); const [wallet, setWallet] = useState(wallets[0]?.id || ''); const [destination, setDestination] = useState(wallets[1]?.id || ''); const [category, setCategory] = useState(categories.find((c) => c.categoryType === 'expense')?.id || ''); const [amount, setAmount] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const amountMinor = Math.round(Number(amount) * 100);
    const endpoint = type === 'transfer' ? '/api/transfers' : '/api/transactions';
    const body = type === 'transfer'
      ? { walletId: wallet, destinationWalletId: destination, amountMinor, description }
      : { walletId: wallet, transactionType: type, categoryId: category || null, amountMinor, description };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || 'Could not post this activity. Please check the details and try again.'); }
    else await onSaved('Activity posted. Your balances are up to date.');
    setBusy(false);
  }
  return <Modal title="Record activity" onClose={onClose}><form className="space-y-4" onSubmit={submit}><label className="field-label">Type<select className="field" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>{(['income', 'expense', 'transfer'] as TransactionType[]).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><label className="field-label">{type === 'transfer' ? 'From wallet' : 'Wallet'}<select className="field" value={wallet} onChange={(e) => setWallet(e.target.value)} required>{wallets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{type === 'transfer' && <label className="field-label">To wallet<select className="field" value={destination} onChange={(e) => setDestination(e.target.value)} required>{wallets.filter((item) => item.id !== wallet).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{type !== 'transfer' && <label className="field-label">Category<select className="field" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Uncategorized</option>{categories.filter((item) => item.categoryType === (type === 'income' ? 'income' : 'expense')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label className="field-label">Amount<input className="field" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></label><label className="field-label">Description<input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" required /></label>{error && <p className="text-sm text-red-600">{error}</p>}<button className="primary-btn w-full" disabled={busy || wallets.length === 0}>{busy ? 'Posting...' : 'Post activity'}</button></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-[#15342d]/30 p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-[26px] bg-white p-7 shadow-2xl dark:bg-[#15201f]"><div className="mb-7 flex items-center justify-between"><h2 className="text-xl font-extrabold">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>; }
