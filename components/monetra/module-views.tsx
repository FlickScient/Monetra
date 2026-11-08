'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { financeApiFetch } from '@/lib/native-api-fetch';
import { FiscusMark } from '@/components/monetra/fiscus-mark';
import { MonetraAIChat } from '@/components/monetra/monetra-ai-chat';
import { BackupControls } from '@/components/monetra/backup-controls';
import {
  Activity,
  CalendarClock,
  CircleHelp,
  HandCoins,
  LockKeyhole,
  MessageSquareText,
  Moon,
  Send,
  ShieldCheck,
  Sun,
  Wallet,
  Plus, Pencil, Trash2, Check, X,
} from 'lucide-react';

function ModuleIntro({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <section className="page-intro module-page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}<span>.</span></h1>
        <p className="intro-copy">{description}</p>
      </div>
      <span className="module-intro-icon" aria-hidden="true">{icon}</span>
    </section>
  );
}

function ModuleStatus({ children }: { children: React.ReactNode }) {
  return <div className="module-status"><span className="module-status-dot" />{children}</div>;
}

const suggestedPrompts = [
  'Where did most of my money go this month?',
  'How much can I safely spend this month?',
  'Compare my Personal and Business cash flow.',
  'Show me recurring expenses that are quietly adding up.',
  'Who owes me money, and what is overdue?',
];

const insightAreas = [
  { icon: Wallet, title: 'Cash-flow clarity', detail: 'Income, spending patterns, and upcoming pressure points.' },
  { icon: CalendarClock, title: 'Forward-looking signals', detail: 'Forecasts, due dates, and safe-to-spend estimates.' },
  { icon: HandCoins, title: 'Debt intelligence', detail: 'Receivables, payables, repayment pace, and strategy.' },
];

type FiscusWorkspace = { id: string; type: 'personal' | 'family' | 'business' };

export function FiscusView({ workspaces, activeWorkspaceId }: { workspaces: FiscusWorkspace[]; activeWorkspaceId: string }) {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceLabel = activeWorkspace?.type === 'family' ? 'Family' : activeWorkspace?.type === 'business' ? 'Business' : 'Personal';

  return (
    <div className="fiscus-page fiscus-dedicated-page" aria-label="Fiscus AI chat">
      <MonetraAIChat key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
      <span className="fiscus-workspace-context">{workspaceLabel} workspace · Private conversation</span>
    </div>
  );
}

function CategoryManager({ workspaceId, onChanged }: { workspaceId: string; onChanged: (categories: { id: string; name: string; categoryType: 'income' | 'expense'; color: string }[]) => void }) {
  type CategoryRow = { id: string; name: string; categoryType: 'income' | 'expense'; color: string };
  const [items, setItems] = useState<CategoryRow[]>([]);
  const [name, setName] = useState('');
  const [categoryType, setCategoryType] = useState<'income' | 'expense'>('expense');
  const [color, setColor] = useState('#0f766e');
  const [editing, setEditing] = useState('');
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'income' | 'expense'>('expense');
  const [editColor, setEditColor] = useState('#0f766e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    financeApiFetch('/api/categories', { headers: { 'x-workspace-id': workspaceId } })
      .then(async response => { const data = await response.json().catch(() => []); if (!response.ok) throw new Error(data.error || 'Could not load categories.'); return data; })
      .then(data => { if (active) setItems(Array.isArray(data) ? data : []); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load categories.'); });
    return () => { active = false; };
  }, [workspaceId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ name, categoryType, color }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not create category.');
      setItems(current => [...current, data]); setName(''); setNotice('Category created.'); onChanged([...items, data]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create category.'); }
    finally { setBusy(false); }
  }

  function beginEdit(item: CategoryRow) { setEditing(item.id); setEditName(item.name); setEditType(item.categoryType); setEditColor(item.color); setError(''); setNotice(''); }
  async function saveEdit(item: CategoryRow) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/categories/' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify({ name: editName, categoryType: editType, color: editColor }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update category.');
      setItems(current => current.map(row => row.id === item.id ? data : row)); setEditing(''); setNotice('Category updated.'); onChanged(items.map(row => row.id === item.id ? data : row));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update category.'); }
    finally { setBusy(false); }
  }
  async function remove(item: CategoryRow) {
    if (!window.confirm('Delete "' + item.name + '"? Existing transactions will become Uncategorized; their amounts and balances will not change.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await financeApiFetch('/api/categories/' + item.id, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not delete category.');
      setItems(current => current.filter(row => row.id !== item.id)); setNotice('Category deleted. Existing transactions were kept.'); onChanged(items.filter(row => row.id !== item.id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete category.'); }
    finally { setBusy(false); }
  }

  return <section className="surface-card settings-section category-manager">
    <div className="settings-section-heading"><div><p className="eyebrow">TRANSACTION ORGANIZATION</p><h2>Categories</h2><p className="section-subtitle">Manage the labels used by income and expenses in this workspace.</p></div><span className="section-icon"><Activity size={18}/></span></div>
    <form className="category-create-form" onSubmit={create}>
      <input value={name} onChange={event => setName(event.target.value)} placeholder="New category name" maxLength={60} required aria-label="New category name"/>
      <select value={categoryType} onChange={event => setCategoryType(event.target.value as 'income' | 'expense')} aria-label="Category type"><option value="expense">Expense</option><option value="income">Income</option></select>
      <input type="color" value={color} onChange={event => setColor(event.target.value)} aria-label="Category color"/>
      <button className="primary-btn" type="submit" disabled={busy || !name.trim()}><Plus size={14}/> Add</button>
    </form>
    {error && <p className="form-error">{error}</p>}
    {notice && <p className="category-notice">{notice}</p>}
    <div className="category-list">
      {items.map(item => <div className="category-item" key={item.id}>
        {editing === item.id ? <>
          <input value={editName} onChange={event => setEditName(event.target.value)} maxLength={60} aria-label="Edit category name"/>
          <select value={editType} onChange={event => setEditType(event.target.value as 'income' | 'expense')} aria-label="Edit category type"><option value="expense">Expense</option><option value="income">Income</option></select>
          <input type="color" value={editColor} onChange={event => setEditColor(event.target.value)} aria-label="Edit category color"/>
          <button type="button" disabled={busy || !editName.trim()} onClick={() => void saveEdit(item)} aria-label="Save category"><Check size={15}/></button>
          <button type="button" disabled={busy} onClick={() => setEditing('')} aria-label="Cancel"><X size={15}/></button>
        </> : <>
          <span className="category-swatch" style={{ background: item.color }}/>
          <strong>{item.name}</strong>
          <small>{item.categoryType}</small>
          <button type="button" disabled={busy} onClick={() => beginEdit(item)} aria-label={'Edit '+item.name}><Pencil size={14}/></button>
          <button type="button" disabled={busy} onClick={() => void remove(item)} aria-label={'Delete '+item.name}><Trash2 size={14}/></button>
        </>}
      </div>)}
      {!items.length && <p className="section-subtitle">No categories available yet.</p>}
    </div>
  </section>;
}

export function SettingsView({ dark, workspaceId, onCategoriesChanged, onToggleTheme }: { dark: boolean; workspaceId: string; onCategoriesChanged: (categories: { id: string; name: string; categoryType: 'income' | 'expense'; color: string }[]) => void; onToggleTheme: () => void }) {
  const [compact, setCompact] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    try {
      setCompact(localStorage.getItem('monetra-compact-ui') === 'true');
      setReducedMotion(localStorage.getItem('monetra-reduced-motion') === 'true');
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('compact-ui', compact);
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
    try {
      localStorage.setItem('monetra-compact-ui', String(compact));
      localStorage.setItem('monetra-reduced-motion', String(reducedMotion));
    } catch {}
  }, [compact, reducedMotion]);

  return (
    <div className="page-stack module-page">
      <ModuleIntro eyebrow="MAKE MONETRA YOURS" title="Settings" description="Manage the experience and review how your financial workspace is organized." icon={<ShieldCheck size={22} />} />
      <section className="surface-card settings-section">
        <div className="settings-section-heading"><div><p className="eyebrow">APPEARANCE</p><h2>Display preferences</h2><p className="section-subtitle">Choose the look that feels right for your day.</p></div><span className="section-icon">{dark ? <Moon size={18} /> : <Sun size={18} />}</span></div>
        <div className="settings-option">
          <span className="settings-option-icon">{dark ? <Moon size={18} /> : <Sun size={18} />}</span>
          <span className="settings-option-copy"><strong>{dark ? 'Dark appearance' : 'Light appearance'}</strong><small>Your preference is saved on this device.</small></span>
          <button className="settings-toggle" type="button" role="switch" aria-checked={dark} onClick={onToggleTheme}><span /></button>
        </div>
      </section>
      <section className="surface-card settings-section">
        <div className="settings-section-heading"><div><p className="eyebrow">YOUR EXPERIENCE</p><h2>Interface preferences</h2><p className="section-subtitle">Fine-tune how Monetra feels on this device.</p></div><span className="section-icon"><Activity size={18} /></span></div>
        <div className="settings-option">
          <span className="settings-option-icon"><Activity size={18} /></span>
          <span className="settings-option-copy"><strong>Compact layout</strong><small>Reduce spacing to fit more information on screen.</small></span>
          <button className="settings-toggle" type="button" role="switch" aria-label="Compact layout" aria-checked={compact} onClick={() => setCompact(value => !value)}><span /></button>
        </div>
        <div className="settings-option">
          <span className="settings-option-icon"><Activity size={18} /></span>
          <span className="settings-option-copy"><strong>Reduce motion</strong><small>Limit page transitions and interface animations.</small></span>
          <button className="settings-toggle" type="button" role="switch" aria-label="Reduce motion" aria-checked={reducedMotion} onClick={() => setReducedMotion(value => !value)}><span /></button>
        </div>
        <p className="settings-local-note">Appearance and interface preferences are stored locally on this device. They do not change your financial records.</p>
      </section>
      <section className="surface-card settings-section">
        <div className="settings-section-heading"><div><p className="eyebrow">FINANCIAL STRUCTURE</p><h2>How your data is organized</h2><p className="section-subtitle">Your workspaces stay separate, with a dedicated ledger for dues and debts.</p></div><span className="section-icon"><Wallet size={18} /></span></div>
        <div className="settings-workspace-list">
          <div><span className="settings-workspace-mark personal">P</span><span><strong>Personal</strong><small>Your individual finances</small></span></div>
          <div><span className="settings-workspace-mark family">F</span><span><strong>Family</strong><small>Shared household finances</small></span></div>
          <div><span className="settings-workspace-mark business">B</span><span><strong>Business</strong><small>Business income and expenses</small></span></div>
          <div><span className="settings-workspace-mark debt">↔</span><span><strong>Due & Debt</strong><small>Independent receivables and payables ledger</small></span></div>
        </div>
      </section>
      <CategoryManager workspaceId={workspaceId} onChanged={onCategoriesChanged} />
      <BackupControls workspaceId={workspaceId} />
      <section className="surface-card settings-section settings-security">
        <LockKeyhole size={18} />
        <div><strong>Account security</strong><p>Sign-in and account security are managed by your Monetra authentication provider.</p></div>
      </section>
    </div>
  );
}
