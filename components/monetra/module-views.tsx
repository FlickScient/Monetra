'use client';

import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BrainCircuit,
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
  'Compare my Personal and Business cash flow.',
  'Who owes me the most, and what is overdue?',
];

export function VaultView() {
  const [draft, setDraft] = useState('');

  return (
    <div className="page-stack module-page">
      <ModuleIntro eyebrow="MONETRA INTELLIGENCE" title="VAULT AI" description="A clearer understanding of your money, backed by your actual records." icon={<BrainCircuit size={22} />} />
      <section className="vault-welcome-card">
        <div className="vault-welcome-orb"><BrainCircuit size={27} /></div>
        <div>
          <p className="eyebrow">YOUR FINANCIAL INTELLIGENCE</p>
          <h2>Ask better questions about your money.</h2>
          <p>VAULT is being designed to analyze your authorized Personal, Family, Business, and Due & Debt records—with workspace-aware answers and transparent calculations.</p>
        </div>
        <div className="vault-security-note"><LockKeyhole size={15} /><span>Private workspace data</span></div>
      </section>
      <section className="surface-card vault-chat-card">
        <div className="vault-chat-heading">
          <span className="vault-chat-icon"><Sparkles size={17} /></span>
          <div><strong>Start with a question</strong><small>Example prompts for the finished assistant</small></div>
          <ModuleStatus>Not connected</ModuleStatus>
        </div>
        <div className="vault-suggestions">
          {suggestedPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => setDraft(prompt)}>{prompt}<MessageSquareText size={14} /></button>
          ))}
        </div>
        <label className="vault-composer">
          <span className="sr-only">Your question for VAULT AI</span>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about your finances…" rows={3} />
          <button type="button" disabled aria-label="Send question"><Send size={17} /></button>
        </label>
        <p className="vault-connection-note"><CircleHelp size={14} /> The interface is ready for integration. No messages are sent or analyzed yet.</p>
      </section>
      <ModuleStatus>Interface foundation ready · AI service integration pending</ModuleStatus>
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
