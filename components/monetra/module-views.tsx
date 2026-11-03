'use client';

import { useState } from 'react';
import { FiscusMark } from '@/components/monetra/fiscus-mark';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  HandCoins,
  LockKeyhole,
  MessageSquareText,
  Moon,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Wallet,
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

export function DueDebtView() {
  return (
    <div className="page-stack module-page">
      <ModuleIntro eyebrow="YOUR SEPARATE LEDGER" title="Due & Debt" description="Keep track of money lent, money borrowed, and every repayment." icon={<HandCoins size={22} />} />
      <div className="module-notice">
        <ShieldCheck size={18} />
        <p><strong>Independent from your everyday finances.</strong><span>Due & Debt balances will not change wallet balances, total assets, income, or ordinary expenses.</span></p>
      </div>
      <section className="module-summary-grid">
        <article className="module-summary-card">
          <span className="module-summary-icon receivable"><ArrowDownLeft size={18} /></span>
          <span className="module-summary-label">MONEY OWED TO YOU</span>
          <strong>—</strong>
          <small>Receivables · awaiting records</small>
        </article>
        <article className="module-summary-card">
          <span className="module-summary-icon payable"><ArrowUpRight size={18} /></span>
          <span className="module-summary-label">MONEY YOU OWE</span>
          <strong>—</strong>
          <small>Payables · awaiting records</small>
        </article>
        <article className="module-summary-card">
          <span className="module-summary-icon neutral"><CalendarClock size={18} /></span>
          <span className="module-summary-label">UPCOMING & OVERDUE</span>
          <strong>—</strong>
          <small>Installments · awaiting records</small>
        </article>
      </section>
      <div className="module-two-column">
        <section className="surface-card module-ledger-card">
          <div className="section-heading">
            <div><p className="eyebrow">RECEIVABLES</p><h2>People who owe you</h2><p className="section-subtitle">Track money you have lent or are due to collect.</p></div>
            <span className="section-icon"><ArrowDownLeft size={18} /></span>
          </div>
          <div className="module-empty-state"><span><HandCoins size={20} /></span><strong>Your receivables will live here</strong><p>People, original amounts, collected amounts, and remaining balances will be organized in one place.</p></div>
        </section>
        <section className="surface-card module-ledger-card">
          <div className="section-heading">
            <div><p className="eyebrow">PAYABLES</p><h2>People you owe</h2><p className="section-subtitle">Keep borrowed money and repayment commitments visible.</p></div>
            <span className="section-icon"><ArrowUpRight size={18} /></span>
          </div>
          <div className="module-empty-state"><span><Wallet size={20} /></span><strong>Your payables will live here</strong><p>Track lenders, outstanding principal, interest, installments, and due dates.</p></div>
        </section>
      </div>
      <section className="surface-card module-history-card">
        <div className="section-heading">
          <div><p className="eyebrow">THE PAPER TRAIL</p><h2>Repayment history</h2><p className="section-subtitle">Every partial payment, collection, and settlement in chronological order.</p></div>
          <span className="section-icon"><CalendarClock size={18} /></span>
        </div>
        <div className="module-history-empty"><CheckCircle2 size={17} /><span>Repayment history will appear when the Due & Debt data connection is ready.</span></div>
      </section>
      <ModuleStatus>Interface foundation ready · Database and API integration pending</ModuleStatus>
    </div>
  );
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

export function FiscusView() {
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState('current');
  const scopeLabel = scope === 'all'
    ? 'All workspaces + Due & Debt'
    : scope === 'current'
      ? 'Selected workspace'
      : scope;

  return (
    <div className="page-stack module-page fiscus-page">
      <ModuleIntro eyebrow="MONETRA INTELLIGENCE" title="Fiscus A.I." description="Your financial co-pilot. Grounded in your records, clear about its reasoning." icon={<FiscusMark size={34} />} />

      <section className="fiscus-hero">
        <div className="fiscus-hero-top">
          <div className="fiscus-identity">
            <span className="fiscus-hero-mark"><FiscusMark size={43} /></span>
            <div><span className="fiscus-kicker">FISCUS INTELLIGENCE ENGINE</span><h2>Understand the numbers.<br /><em>Make the next move.</em></h2></div>
          </div>
          <span className="fiscus-offline"><i /> Backend connection pending</span>
        </div>
        <p className="fiscus-hero-copy">Ask questions across your money life. Fiscus is being built to explain what happened, what may happen next, and which decisions deserve a closer look.</p>
        <div className="fiscus-principles">
          <span><ShieldCheck size={14} /> Record-backed answers</span>
          <span><Activity size={14} /> Transparent calculations</span>
          <span><LockKeyhole size={14} /> Permission-aware access</span>
        </div>
      </section>

      <section className="fiscus-scope-bar surface-card">
        <div className="fiscus-scope-copy"><span className="eyebrow">ANALYSIS SCOPE</span><strong>{scopeLabel}</strong><small>Choose which financial records a future answer may use.</small></div>
        <label className="fiscus-scope-select"><span className="sr-only">Choose analysis scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="current">Selected workspace</option>
            <option value="Personal">Personal workspace</option>
            <option value="Family">Family workspace</option>
            <option value="Business">Business workspace</option>
            <option value="all">All workspaces + Due & Debt</option>
          </select>
        </label>
      </section>

      <div className="fiscus-content-grid">
        <section className="surface-card fiscus-chat-card">
          <div className="fiscus-section-heading">
            <div><span className="eyebrow">ASK FISCUS</span><h2>What would you like to know?</h2><p className="section-subtitle">Start with a question. The assistant is not connected yet.</p></div>
            <span className="fiscus-chat-mark"><FiscusMark size={25} /></span>
          </div>
          <div className="fiscus-prompt-grid">
            {suggestedPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)}>{prompt}<MessageSquareText size={14} /></button>)}
          </div>
          <label className="fiscus-composer">
            <span className="sr-only">Your question for Fiscus A.I.</span>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask something about your finances…" rows={3} />
            <span className="fiscus-composer-bottom"><small>Scope: {scopeLabel}</small><button type="button" disabled aria-label="Send question"><Send size={16} /> Send</button></span>
          </label>
          <p className="fiscus-honesty-note"><CircleHelp size={14} /> No message is sent, no records are analyzed, and no AI response is generated until the backend is connected.</p>
        </section>

        <aside className="fiscus-side-stack">
          <section className="surface-card fiscus-capabilities">
            <span className="eyebrow">BUILT TO HELP YOU SEE</span><h2>More than a chatbot.</h2>
            <div className="fiscus-capability-list">
              {insightAreas.map(({ icon: Icon, title, detail }) => <div key={title}><span><Icon size={16} /></span><div><strong>{title}</strong><small>{detail}</small></div></div>)}
            </div>
          </section>
          <section className="fiscus-trust-card">
            <div><LockKeyhole size={17} /><strong>Trust before cleverness.</strong></div>
            <p>Fiscus must separate actual records from estimates, show the period and workspace behind each answer, and never invent missing numbers.</p>
          </section>
        </aside>
      </div>
      <ModuleStatus>Interface ready · AI service, record retrieval, and response streaming pending</ModuleStatus>
    </div>
  );
}

export function SettingsView({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
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
        <div className="settings-section-heading"><div><p className="eyebrow">FINANCIAL STRUCTURE</p><h2>How your data is organized</h2><p className="section-subtitle">Your workspaces stay separate, with a dedicated ledger for dues and debts.</p></div><span className="section-icon"><Wallet size={18} /></span></div>
        <div className="settings-workspace-list">
          <div><span className="settings-workspace-mark personal">P</span><span><strong>Personal</strong><small>Your individual finances</small></span></div>
          <div><span className="settings-workspace-mark family">F</span><span><strong>Family</strong><small>Shared household finances</small></span></div>
          <div><span className="settings-workspace-mark business">B</span><span><strong>Business</strong><small>Business income and expenses</small></span></div>
          <div><span className="settings-workspace-mark debt">↔</span><span><strong>Due & Debt</strong><small>Independent receivables and payables ledger</small></span></div>
        </div>
      </section>
      <section className="surface-card settings-section settings-security">
        <LockKeyhole size={18} />
        <div><strong>Account security</strong><p>Sign-in and account security are managed by your Monetra authentication provider.</p></div>
      </section>
      <ModuleStatus>Settings foundation ready · Additional preferences can be added with backend contracts</ModuleStatus>
    </div>
  );
}
