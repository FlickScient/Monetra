'use client';

import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Check, CirclePlus, HandCoins, History, Plus, Search, ShieldCheck, Wallet, X } from 'lucide-react';

type Direction = 'receivable' | 'payable';
type Entry = { id: string; direction: Direction; person: string; note: string; principal: number; rate: number; dueDate: string; createdAt: string; repayments: { id: string; amount: number; date: string; note: string }[] };
const taka = (minor: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(Math.round(minor / 100));
const toMinor = (value: string) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const outstanding = (entry: Entry) => Math.max(0, entry.principal - entry.repayments.reduce((sum, payment) => sum + payment.amount, 0));
const today = () => new Date().toISOString().slice(0, 10);

export function DueDebtView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [direction, setDirection] = useState<Direction>('receivable');
  const [person, setPerson] = useState('');
  const [note, setNote] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [repayId, setRepayId] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayNote, setRepayNote] = useState('');
  const [filter, setFilter] = useState<'all' | Direction>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const receivables = entries.filter(e => e.direction === 'receivable');
  const payables = entries.filter(e => e.direction === 'payable');
  const totalReceivable = receivables.reduce((sum, e) => sum + outstanding(e), 0);
  const totalPayable = payables.reduce((sum, e) => sum + outstanding(e), 0);
  const overdue = entries.filter(e => outstanding(e) > 0 && e.dueDate && e.dueDate < today());
  const upcoming = entries.filter(e => outstanding(e) > 0 && e.dueDate && e.dueDate >= today() && e.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const history = entries.flatMap(e => e.repayments.map(p => ({ ...p, person: e.person, direction: e.direction, entryNote: e.note }))).sort((a, b) => b.date.localeCompare(a.date));
  const visible = useMemo(() => entries.filter(e => (filter === 'all' || e.direction === filter) && (e.person + ' ' + e.note).toLowerCase().includes(search.toLowerCase())), [entries, filter, search]);

  function createEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person.trim() || !toMinor(principal)) { setError('Add a person or business name and a valid amount.'); return; }
    setEntries(current => [{ id: crypto.randomUUID(), direction, person: person.trim(), note: note.trim(), principal: toMinor(principal), rate: Math.max(0, Number(rate) || 0), dueDate, createdAt: today(), repayments: [] }, ...current]);
    setPerson(''); setNote(''); setPrincipal(''); setRate('0'); setDueDate(''); setError(''); setShowCreate(false);
  }
  function addRepayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = toMinor(repayAmount);
    const entry = entries.find(e => e.id === repayId);
    if (!entry || !amount || amount > outstanding(entry)) { setError('Enter a repayment greater than zero and no more than the outstanding principal.'); return; }
    setEntries(current => current.map(e => e.id === repayId ? { ...e, repayments: [...e.repayments, { id: crypto.randomUUID(), amount, date: today(), note: repayNote.trim() }] } : e));
    setRepayAmount(''); setRepayNote(''); setRepayId(''); setError('');
  }

  return <div className="page-stack module-page due-debt-page">
    <section className="page-intro"><div><p className="eyebrow">YOUR SEPARATE LEDGER</p><h1>Due & Debt<span>.</span></h1><p className="intro-copy">Know what should come back, what must go out, and when.</p></div><button className="primary-btn" onClick={() => { setDirection('receivable'); setShowCreate(true); }}><Plus size={16} /> Add record</button></section>
    <div className="module-notice"><ShieldCheck size={18} /><p><strong>Independent from everyday finances.</strong><span>Entries and repayments here do not change wallets, assets, income or ordinary expenses.</span></p></div>
    <section className="due-summary-grid">
      <article className="module-summary-card"><span className="module-summary-icon receivable"><ArrowDownLeft size={18}/></span><span className="module-summary-label">OWED TO YOU</span><strong>{taka(totalReceivable)}</strong><small>{receivables.length} active record{receivables.length===1?'':'s'}</small></article>
      <article className="module-summary-card"><span className="module-summary-icon payable"><ArrowUpRight size={18}/></span><span className="module-summary-label">YOU OWE</span><strong>{taka(totalPayable)}</strong><small>{payables.length} active record{payables.length===1?'':'s'}</small></article>
      <article className="module-summary-card"><span className="module-summary-icon neutral"><CalendarClock size={18}/></span><span className="module-summary-label">NEEDS ATTENTION</span><strong>{overdue.length + upcoming.length}</strong><small>{overdue.length} overdue · {upcoming.length} due in 7 days</small></article>
    </section>
    <section className="surface-card due-ledger">
      <div className="section-heading"><div><p className="eyebrow">YOUR LEDGER</p><h2>All records</h2><p className="section-subtitle">Track counterparties, principal and remaining balances.</p></div><span className="section-icon"><HandCoins size={18}/></span></div>
      <div className="due-toolbar"><div className="due-search"><Search size={15}/><input aria-label="Search people or notes" placeholder="Search people or notes" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="due-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>All</button><button className={filter==='receivable'?'active':''} onClick={()=>setFilter('receivable')}>Owed to me</button><button className={filter==='payable'?'active':''} onClick={()=>setFilter('payable')}>I owe</button></div></div>
      {visible.length ? <div className="due-record-list">{visible.map(entry=>{const remaining=outstanding(entry);const paid=entry.principal-remaining;const isOverdue=remaining>0&&entry.dueDate&&entry.dueDate<today();return <article className="due-record" key={entry.id}><div className={'due-record-mark '+entry.direction}>{entry.direction==='receivable'?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</div><div className="due-record-main"><div className="due-record-title"><strong>{entry.person}</strong><span className={'due-direction '+entry.direction}>{entry.direction==='receivable'?'TO COLLECT':'TO REPAY'}</span></div><p>{entry.note||'No description'}{entry.dueDate?' · Due '+entry.dueDate:''}</p><div className="due-record-progress"><span style={{width:Math.min(100,paid/entry.principal*100)+'%'}}/></div><small>{taka(paid)} paid of {taka(entry.principal)}</small></div><div className="due-record-balance"><strong>{taka(remaining)}</strong><small>Outstanding</small>{isOverdue&&<span className="due-overdue">Overdue</span>}{remaining===0&&<span className="due-settled">Settled</span>}</div><button className="due-repay-btn" disabled={remaining===0} onClick={()=>{setRepayId(entry.id);setRepayAmount('');setError('');}}>Add repayment</button></article>})}</div>:<div className="module-empty-state due-empty"><span><HandCoins size={20}/></span><strong>{entries.length?'No matching records':'Your separate ledger starts here'}</strong><p>{entries.length?'Try another search or filter.':'Add money you lent or borrowed. Partial repayments will reduce the outstanding balance here only.'}</p><button className="text-action" onClick={()=>setShowCreate(true)}><CirclePlus size={15}/> Create your first record</button></div>}
    </section>
    <div className="due-lower-grid">
      <section className="surface-card due-attention"><div className="section-heading"><div><p className="eyebrow">DATE WATCH</p><h2>Upcoming & overdue</h2></div><span className="section-icon"><CalendarClock size={18}/></span></div>{overdue.length+upcoming.length===0?<p className="due-muted">No due dates need attention in the next seven days.</p>:<div className="due-attention-list">{[...overdue,...upcoming].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(e=><div key={e.id}><span><b>{e.person}</b><small>{e.direction==='receivable'?'Collect':'Repay'} · {e.dueDate}</small></span><strong>{taka(outstanding(e))}</strong></div>)}</div>}</section>
      <section className="surface-card due-history"><div className="section-heading"><div><p className="eyebrow">THE PAPER TRAIL</p><h2>Repayment history</h2></div><span className="section-icon"><History size={18}/></span></div>{history.length?<div className="due-attention-list">{history.slice(0,8).map(p=><div key={p.id}><span><b>{p.person}</b><small>{p.direction==='receivable'?'Collected':'Repaid'} · {p.date}</small></span><strong>{taka(p.amount)}</strong></div>)}</div>:<p className="due-muted">Partial repayments and settlements will appear here.</p>}</section>
    </div>
    <div className="due-integrity-note"><Wallet size={15}/> This is a frontend-only working prototype. Records are held in page memory and reset on refresh; database persistence, interest accounting and API integration are reserved for the backend handoff.</div>

    {showCreate&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreate(false);}}><section className="modal-card due-modal" role="dialog" aria-modal="true" aria-labelledby="due-create-title"><div className="modal-heading"><div><p className="eyebrow">NEW LEDGER ENTRY</p><h2 id="due-create-title">Add a due or debt</h2></div><button className="icon-btn" onClick={()=>setShowCreate(false)} aria-label="Close"><X size={18}/></button></div><form onSubmit={createEntry} className="due-form"><div className="due-direction-picker"><button type="button" className={direction==='receivable'?'active':''} onClick={()=>setDirection('receivable')}><ArrowDownLeft size={16}/> Someone owes me</button><button type="button" className={direction==='payable'?'active':''} onClick={()=>setDirection('payable')}><ArrowUpRight size={16}/> I owe someone</button></div><label>Person or business<input autoFocus value={person} onChange={e=>setPerson(e.target.value)} placeholder="e.g. Rahim / ABC Traders" /></label><label>Original principal (৳)<input type="number" min="0.01" step="0.01" value={principal} onChange={e=>setPrincipal(e.target.value)} placeholder="0.00"/></label><div className="due-form-row"><label>Annual interest (%)<input type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} /></label><label>Due date<input type="date" min={today()} value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div><label>Note (optional)<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Purpose or reference"/></label>{error&&<p className="due-form-error">{error}</p>}<div className="due-modal-actions"><button type="button" className="secondary-btn" onClick={()=>setShowCreate(false)}>Cancel</button><button type="submit" className="primary-btn"><Check size={15}/> Add record</button></div></form></section></div>}
    {repayId&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setRepayId('');}}><section className="modal-card due-modal" role="dialog" aria-modal="true" aria-labelledby="due-repay-title"><div className="modal-heading"><div><p className="eyebrow">RECORD A PAYMENT</p><h2 id="due-repay-title">Add repayment</h2></div><button className="icon-btn" onClick={()=>setRepayId('')} aria-label="Close"><X size={18}/></button></div><form onSubmit={addRepayment} className="due-form"><p className="due-muted">Outstanding principal: <strong>{taka(outstanding(entries.find(e=>e.id===repayId)!))}</strong></p><label>Amount (৳)<input autoFocus type="number" min="0.01" step="0.01" max={outstanding(entries.find(e=>e.id===repayId)!)/100} value={repayAmount} onChange={e=>setRepayAmount(e.target.value)} placeholder="0.00"/></label><label>Note (optional)<input value={repayNote} onChange={e=>setRepayNote(e.target.value)} placeholder="Cash / bank / partial settlement"/></label>{error&&<p className="due-form-error">{error}</p>}<div className="due-modal-actions"><button type="button" className="secondary-btn" onClick={()=>setRepayId('')}>Cancel</button><button type="submit" className="primary-btn"><Check size={15}/> Save repayment</button></div></form></section></div>}
  </div>;
}
