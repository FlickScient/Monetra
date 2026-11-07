'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, CirclePlus, Download, HandCoins, History, Pencil, Plus, Search, ShieldCheck, Trash2, Wallet, X } from 'lucide-react';
import { isNativeFinanceApp, queueNativeDebtPayment, readCachedNativeWorkspace } from '@/lib/offline/native-finance';

type Direction = 'receivable' | 'payable';
type Payment = { id: string; amount: number; date: string; note: string };
type Entry = { id: string; direction: Direction; person: string; note: string; principal: number; dueDate: string; createdAt: string; repayments: Payment[] };
type ApiDebt = { id: string; direction: Direction; counterpartyName: string; note: string | null; principalMinor: number; dueDate: string | null; createdAt: string; repayments: Payment[] };
const taka = (minor: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(Math.round(minor / 100));
const toMinor = (value: string) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const outstanding = (entry: Entry) => Math.max(0, entry.principal - entry.repayments.reduce((sum, payment) => sum + payment.amount, 0));
const localDate = (date = new Date()) => { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return year + '-' + month + '-' + day; };
const today = () => localDate();
const mapApiDebt = (item: ApiDebt): Entry => ({
  id: item.id, direction: item.direction, person: item.counterpartyName, note: item.note || '',
  principal: Number(item.principalMinor), dueDate: item.dueDate || '', createdAt: String(item.createdAt).slice(0, 10), repayments: item.repayments || [],
});

export function DueDebtView({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<Direction>('receivable');
  const [person, setPerson] = useState('');
  const [note, setNote] = useState('');
  const [principal, setPrincipal] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [repayId, setRepayId] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayNote, setRepayNote] = useState('');
  const [paymentEdit, setPaymentEdit] = useState<{ debtId: string; payment: Payment } | null>(null);
  const [paymentEditAmount, setPaymentEditAmount] = useState('');
  const [paymentEditDate, setPaymentEditDate] = useState('');
  const [paymentEditNote, setPaymentEditNote] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | Direction | 'pending' | 'partial' | 'overdue' | 'settled'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const paymentKeyRef = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    setEntries([]);
    setLoading(true);
    setError('');
    fetch('/api/due-debt', { headers: { 'x-workspace-id': workspaceId } })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load Due & Debt records.');
        return data;
      })
      .then(data => { if (active) setEntries(Array.isArray(data) ? data.map(mapApiDebt) : []); })
      .catch(async err => {
        if (isNativeFinanceApp()) {
          try {
            const cached = await readCachedNativeWorkspace(workspaceId);
            const paymentsByDebt = new Map<string, Payment[]>();
            for (const raw of cached.dueDebtPayments) {
              const payment = raw as { id?: string; dueDebtId?: string; amountMinor?: number; paidAt?: string; note?: string | null };
              if (!payment.id || !payment.dueDebtId) continue;
              const list = paymentsByDebt.get(payment.dueDebtId) || [];
              list.push({
                id: payment.id,
                amount: Number(payment.amountMinor || 0),
                date: String(payment.paidAt || '').slice(0, 10),
                note: payment.note || '',
              });
              paymentsByDebt.set(payment.dueDebtId, list);
            }
            const cachedEntries = cached.dueDebts.map(raw => {
              const debt = raw as ApiDebt;
              return mapApiDebt({ ...debt, repayments: paymentsByDebt.get(debt.id) || [] });
            });
            if (active && cachedEntries.length) {
              setEntries(cachedEntries);
              setNotice('Offline mode · your separate Due & Debt ledger is loaded from this device.');
              return;
            }
          } catch {
            // Fall through to the normal load error if no usable local snapshot exists.
          }
        }
        if (active) setError(err instanceof Error ? err.message : 'Could not load Due & Debt records.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  const receivables = entries.filter(e => e.direction === 'receivable' && outstanding(e) > 0);
  const payables = entries.filter(e => e.direction === 'payable' && outstanding(e) > 0);
  const settledEntries = entries.filter(e => outstanding(e) === 0);
  const totalSettled = settledEntries.reduce((sum, e) => sum + e.principal, 0);
  const totalPrincipal = entries.reduce((sum, e) => sum + e.principal, 0);
  const totalReceivable = receivables.reduce((sum, e) => sum + outstanding(e), 0);
  const totalPayable = payables.reduce((sum, e) => sum + outstanding(e), 0);
  const overdue = entries.filter(e => outstanding(e) > 0 && e.dueDate && e.dueDate < today());
  const upcoming = entries.filter(e => outstanding(e) > 0 && e.dueDate && e.dueDate >= today() && e.dueDate <= localDate(new Date(Date.now() + 7 * 86400000)));
  const history = entries.flatMap(e => e.repayments.map(p => ({ ...p, debtId: e.id, person: e.person, direction: e.direction }))).sort((a, b) => b.date.localeCompare(a.date));
  const visible = useMemo(() => entries.filter(e => {
    const remaining = outstanding(e);
    const isOverdue = remaining > 0 && !!e.dueDate && e.dueDate < today();
    const isPartial = remaining > 0 && remaining < e.principal;
    const statusMatch = filter === 'all' || (filter === 'receivable' && e.direction === 'receivable') || (filter === 'payable' && e.direction === 'payable') || (filter === 'settled' && remaining === 0) || (filter === 'pending' && remaining === e.principal && !isOverdue) || (filter === 'partial' && isPartial) || (filter === 'overdue' && isOverdue);
    return statusMatch && (e.person + ' ' + e.note).toLowerCase().includes(search.toLowerCase());
  }), [entries, filter, search]);
  const selectedRepayEntry = entries.find(entry => entry.id === repayId);

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person.trim() || !toMinor(principal)) { setError('Add a person or business name and a valid amount.'); return; }
    setError('');
    try {
      const response = await fetch(editingId ? '/api/due-debt/' + editingId : '/api/due-debt', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ direction, counterpartyName: person.trim(), note: note.trim() || null, principalMinor: toMinor(principal), dueDate: dueDate || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not create this record.');
      const mapped = mapApiDebt({ ...data, repayments: editingId ? (entries.find(item => item.id === editingId)?.repayments || []) : [] } as ApiDebt);
      setEntries(current => editingId ? current.map(item => item.id === editingId ? mapped : item) : [mapped, ...current]);
      setPerson(''); setNote(''); setPrincipal(''); setDueDate(''); setShowCreate(false); setEditingId('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create this record.'); }
  }

  async function deleteEntry(entry: Entry) {
    if (!window.confirm('Archive the record for ' + entry.person + '? Its payment history will be preserved.')) return;
    try {
      const response = await fetch('/api/due-debt/' + entry.id, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not archive this record.');
      setEntries(current => current.filter(item => item.id !== entry.id));
      if (repayId === entry.id) setRepayId('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not archive this record.'); }
  }

  async function addRepayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = toMinor(repayAmount);
    const entry = entries.find(e => e.id === repayId);
    if (!entry || !amount || amount > outstanding(entry)) { setError('Enter a payment greater than zero and no more than the outstanding principal.'); return; }
    setError('');
    const signature = JSON.stringify({ workspaceId, repayId, amount, note: repayNote.trim() || null });
    const idempotencyKey = paymentKeyRef.current?.signature === signature
      ? paymentKeyRef.current.key
      : crypto.randomUUID();
    paymentKeyRef.current = { signature, key: idempotencyKey };
    try {
      let payment: { id: string; amountMinor: number; paidAt: string; note?: string | null } | null = null;
      let response: Response | null = null;
      try {
        response = await fetch('/api/due-debt/' + repayId + '/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId, 'idempotency-key': idempotencyKey },
          body: JSON.stringify({ amountMinor: amount, note: repayNote.trim() || null }),
        });
      } catch {
        if (!isNativeFinanceApp()) throw new Error('Connection issue. Please try again.');
        const paidAt = new Date().toISOString();
        await queueNativeDebtPayment(workspaceId, {
          operationId: idempotencyKey,
          dueDebtId: repayId,
          amountMinor: amount,
          paidAt,
          note: repayNote.trim() || null,
        });
        payment = { id: idempotencyKey, amountMinor: amount, paidAt, note: repayNote.trim() || null };
        setNotice('Payment saved on this device. It will sync when you reconnect.');
      }
      if (response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not record this payment.');
        if (!data.payment || typeof data.payment.id !== 'string') throw new Error('The server returned an invalid payment.');
        payment = data.payment;
      }
      if (!payment) throw new Error('Could not record this payment.');
      const savedPayment = payment;
      setEntries(current => current.map(item => item.id === repayId ? {
        ...item,
        repayments: item.repayments.some(existing => existing.id === savedPayment.id)
          ? item.repayments
          : [...item.repayments, { id: savedPayment.id, amount: Number(savedPayment.amountMinor), date: String(savedPayment.paidAt).slice(0, 10), note: savedPayment.note || '' }],
      } : item));
      paymentKeyRef.current = null;
      setRepayAmount(''); setRepayNote(''); setRepayId('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record this payment.'); }
  }


  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentEdit || paymentBusy) return;
    const amount = toMinor(paymentEditAmount);
    if (!amount) { setError('Enter a valid payment amount.'); return; }
    setPaymentBusy(true); setError('');
    try {
      const response = await fetch('/api/due-debt/' + paymentEdit.debtId + '/payments/' + paymentEdit.payment.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ amountMinor: amount, paidAt: paymentEditDate, note: paymentEditNote.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update payment.');
      setEntries(current => current.map(entry => entry.id === paymentEdit.debtId ? {
        ...entry, repayments: entry.repayments.map(p => p.id === paymentEdit.payment.id
          ? { ...p, amount: Number(data.payment.amountMinor), date: String(data.payment.paidAt).slice(0,10), note: data.payment.note || '' } : p)
      } : entry));
      setPaymentEdit(null); setNotice('Payment updated. Outstanding balance recalculated.'); setTimeout(()=>setNotice(''),3500);
    } catch(err) { setError(err instanceof Error ? err.message : 'Could not update payment.'); }
    finally { setPaymentBusy(false); }
  }

  async function deletePayment(debtId: string, payment: Payment) {
    if (!window.confirm('Delete this payment of ' + taka(payment.amount) + '? The outstanding balance will increase again.')) return;
    try {
      const response = await fetch('/api/due-debt/' + debtId + '/payments/' + payment.id, { method:'DELETE', headers:{'x-workspace-id':workspaceId} });
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || 'Could not delete payment.');
      setEntries(current => current.map(entry => entry.id===debtId ? {...entry,repayments:entry.repayments.filter(p=>p.id!==payment.id)} : entry));
      setNotice('Payment deleted. Outstanding balance recalculated.'); setTimeout(()=>setNotice(''),3500);
    } catch(err) { setError(err instanceof Error ? err.message : 'Could not delete payment.'); }
  }

  function exportDueDebtCsv() {
    const rows = [['Type','Person','Note','Principal BDT','Paid BDT','Outstanding BDT','Status','Due date','Payment date','Payment BDT','Payment note']];
    for (const entry of entries) {
      const paid = entry.repayments.reduce((sum,p)=>sum+p.amount,0);
      const remaining = outstanding(entry);
      const status = remaining===0?'Paid':entry.dueDate && entry.dueDate<today()?'Overdue':paid>0?'Partially Paid':'Pending';
      if (!entry.repayments.length) rows.push([entry.direction,entry.person,entry.note,(entry.principal/100).toFixed(2),(paid/100).toFixed(2),(remaining/100).toFixed(2),status,entry.dueDate,'','','']);
      else for (const payment of entry.repayments) rows.push([entry.direction,entry.person,entry.note,(entry.principal/100).toFixed(2),(paid/100).toFixed(2),(remaining/100).toFixed(2),status,entry.dueDate,payment.date,(payment.amount/100).toFixed(2),payment.note]);
    }
    const csv = rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download='monetra-due-debt.csv'; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="page-stack module-page due-debt-page">
    <section className="page-intro"><div><p className="eyebrow">YOUR SEPARATE LEDGER</p><h1>Due & Debt<span>.</span></h1><p className="intro-copy">Know what should come back, what must go out, and when.</p></div><button className="primary-btn" onClick={() => { setEditingId(''); setDirection('receivable'); setPerson(''); setNote(''); setPrincipal(''); setDueDate(''); setShowCreate(true); }}><Plus size={16} /> Add record</button></section>
    <div className="module-notice"><ShieldCheck size={18} /><p><strong>Independent from everyday finances.</strong><span>Entries and repayments here do not change wallets, assets, income or ordinary expenses.</span></p></div>
    <section className="due-summary-grid">
      <article className="module-summary-card"><span className="module-summary-icon receivable"><ArrowDownLeft size={18}/></span><span className="module-summary-label">OWED TO YOU</span><strong>{taka(totalReceivable)}</strong><small>{receivables.length} active record{receivables.length===1?'':'s'}</small></article>
      <article className="module-summary-card"><span className="module-summary-icon payable"><ArrowUpRight size={18}/></span><span className="module-summary-label">YOU OWE</span><strong>{taka(totalPayable)}</strong><small>{payables.length} active record{payables.length===1?'':'s'}</small></article>
      <article className="module-summary-card"><span className="module-summary-icon neutral"><CalendarClock size={18}/></span><span className="module-summary-label">NEEDS ATTENTION</span><strong>{overdue.length + upcoming.length}</strong><small>{overdue.length} overdue · {upcoming.length} due in 7 days</small></article>
      <article className="module-summary-card"><span className="module-summary-icon neutral"><ShieldCheck size={18}/></span><span className="module-summary-label">SETTLED</span><strong>{taka(totalSettled)}</strong><small>{settledEntries.length} fully paid · {entries.length} total records</small></article>
    </section>
    <section className="surface-card due-ledger">
      <div className="section-heading"><div><p className="eyebrow">YOUR LEDGER</p><h2>All records</h2><p className="section-subtitle">Track counterparties, principal and remaining balances.</p></div><div className="due-heading-actions"><button type="button" className="secondary-btn" onClick={exportDueDebtCsv}><Download size={14}/> Export CSV</button><span className="section-icon"><HandCoins size={18}/></span></div></div>
      <div className="due-toolbar"><div className="due-search"><Search size={15}/><input aria-label="Search people or notes" placeholder="Search people or notes" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="due-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>All</button><button className={filter==='receivable'?'active':''} onClick={()=>setFilter('receivable')}>Owed to me</button><button className={filter==='payable'?'active':''} onClick={()=>setFilter('payable')}>I owe</button><button className={filter==='pending'?'active':''} onClick={()=>setFilter('pending')}>Pending</button><button className={filter==='partial'?'active':''} onClick={()=>setFilter('partial')}>Partial</button><button className={filter==='overdue'?'active':''} onClick={()=>setFilter('overdue')}>Overdue</button><button className={filter==='settled'?'active':''} onClick={()=>setFilter('settled')}>Paid</button></div></div>
      {error && <p className="due-form-error">{error}</p>}
      {loading ? <p className="due-muted">Loading your ledger…</p> : visible.length ? <div className="due-record-list">{visible.map(entry=>{const remaining=outstanding(entry);const paid=entry.principal-remaining;const isOverdue=remaining>0&&entry.dueDate&&entry.dueDate<today();return <article className="due-record" key={entry.id}><div className={'due-record-mark '+entry.direction}>{entry.direction==='receivable'?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</div><div className="due-record-main"><div className="due-record-title"><strong>{entry.person}</strong><span className={'due-direction '+entry.direction}>{entry.direction==='receivable'?'TO COLLECT':'TO REPAY'}</span></div><p>{entry.note||'No description'}{entry.dueDate?' · Due '+entry.dueDate:''}</p><div className="due-record-progress"><span style={{width:Math.min(100,paid/entry.principal*100)+'%'}}/></div><small>{taka(paid)} paid of {taka(entry.principal)}</small></div><div className="due-record-balance"><strong>{taka(remaining)}</strong><small>Outstanding</small><span className={remaining===0?'due-settled':isOverdue?'due-overdue':paid>0?'due-partial':'due-pending'}>{remaining===0?'Paid':isOverdue?'Overdue':paid>0?'Partially Paid':'Pending'}</span></div><div className="due-record-actions">{remaining>0&&<><button className="due-repay-btn" onClick={()=>{setRepayId(entry.id);setRepayAmount('');setRepayNote('');setError('');}}>{entry.direction==='receivable'?'Record collection':'Record repayment'}</button><button className="due-settle-btn" onClick={()=>{setRepayId(entry.id);setRepayAmount((remaining/100).toFixed(2));setRepayNote('Final settlement');setError('');}}>Mark paid · {taka(remaining)}</button></>}<button type="button" className="due-repay-btn" onClick={()=>{setEditingId(entry.id);setDirection(entry.direction);setPerson(entry.person);setNote(entry.note);setPrincipal((entry.principal/100).toFixed(2));setDueDate(entry.dueDate);setShowCreate(true);setError('');}}>Edit</button><button type="button" className="due-delete-btn" onClick={()=>deleteEntry(entry)} aria-label={'Archive record for '+entry.person} title="Archive record"><Trash2 size={14}/></button></div>{entry.repayments.length>0&&<details className="due-payment-details"><summary>Payment history ({entry.repayments.length})</summary><div>{entry.repayments.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(payment=><div className="due-payment-row" key={payment.id}><span><b>{taka(payment.amount)}</b><small>{payment.date}{payment.note?' · '+payment.note:''}</small></span><span><button type="button" onClick={()=>{setPaymentEdit({debtId:entry.id,payment});setPaymentEditAmount((payment.amount/100).toFixed(2));setPaymentEditDate(payment.date);setPaymentEditNote(payment.note);}}>Edit</button><button type="button" className="danger" onClick={()=>void deletePayment(entry.id,payment)}>Delete</button></span></div>)}</div></details>}</article>})}</div>:<div className="module-empty-state due-empty"><span><HandCoins size={20}/></span><strong>{entries.length?'No matching records':'Your separate ledger starts here'}</strong><p>{entries.length?'Try another search or filter.':'Add money you lent or borrowed. Partial repayments will reduce the outstanding balance here only.'}</p><button className="text-action" onClick={()=>setShowCreate(true)}><CirclePlus size={15}/> Create your first record</button></div>}
    </section>
    <div className="due-lower-grid">
      <section className="surface-card due-attention"><div className="section-heading"><div><p className="eyebrow">DATE WATCH</p><h2>Upcoming & overdue</h2></div><span className="section-icon"><CalendarClock size={18}/></span></div>{overdue.length+upcoming.length===0?<p className="due-muted">No due dates need attention in the next seven days.</p>:<div className="due-attention-list">{[...overdue,...upcoming].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(e=><div key={e.id}><span><b>{e.person}</b><small>{e.direction==='receivable'?'Collect':'Repay'} · {e.dueDate}</small></span><strong>{taka(outstanding(e))}</strong></div>)}</div>}</section>
      <section className="surface-card due-history"><div className="section-heading"><div><p className="eyebrow">THE PAPER TRAIL</p><h2>Repayment history</h2></div><span className="section-icon"><History size={18}/></span></div>{history.length?<div className="due-attention-list">{history.slice(0,8).map(p=><div key={p.id}><span><b>{p.person}</b><small>{p.direction==='receivable'?'Collected':'Repaid'} · {p.date}</small></span><strong>{taka(p.amount)}</strong></div>)}</div>:<p className="due-muted">Partial repayments and settlements will appear here.</p>}</section>
    </div>
    <div className="due-integrity-note"><Wallet size={15}/> This ledger is saved to your account and isolated by workspace. Payments are recorded here only; they do not change wallet balances or everyday income and expenses.</div>

    {notice&&<p className="due-success-note">{notice}</p>}
    {showCreate&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreate(false);}}><section className="modal-card due-modal" role="dialog" aria-modal="true" aria-labelledby="due-create-title"><div className="modal-heading"><div><p className="eyebrow">NEW LEDGER ENTRY</p><h2 id="due-create-title">{editingId ? 'Edit due or debt' : 'Add a due or debt'}</h2></div><button className="icon-btn" onClick={()=>setShowCreate(false)} aria-label="Close"><X size={18}/></button></div><form onSubmit={createEntry} className="due-form"><div className="due-direction-picker"><button type="button" className={direction==='receivable'?'active':''} onClick={()=>setDirection('receivable')}><ArrowDownLeft size={16}/> Someone owes me</button><button type="button" className={direction==='payable'?'active':''} onClick={()=>setDirection('payable')}><ArrowUpRight size={16}/> I owe someone</button></div><label>Person or business<input autoFocus value={person} onChange={e=>setPerson(e.target.value)} placeholder="Name" required /></label><label>Principal amount (৳)<input type="number" min="0.01" step="0.01" value={principal} onChange={e=>setPrincipal(e.target.value)} placeholder="0.00" required /></label><label>Due date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} /></label><label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional details" /></label><button className="primary-btn" type="submit">{editingId ? 'Save changes' : <><Plus size={15}/> Save record</>}</button></form></section></div>}

    {paymentEdit&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setPaymentEdit(null);}}><section className="modal-card due-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">EDIT PAYMENT</p><h2>Update payment</h2></div><button className="icon-btn" onClick={()=>setPaymentEdit(null)} aria-label="Close"><X size={18}/></button></div><form className="due-form" onSubmit={savePayment}><label>Amount (৳)<input type="number" min="0.01" step="0.01" value={paymentEditAmount} onChange={e=>setPaymentEditAmount(e.target.value)} required /></label><label>Payment date<input type="date" value={paymentEditDate} onChange={e=>setPaymentEditDate(e.target.value)} required /></label><label>Note<input value={paymentEditNote} onChange={e=>setPaymentEditNote(e.target.value)} /></label><button className="primary-btn" type="submit" disabled={paymentBusy}>{paymentBusy?'Saving…':'Save payment changes'}</button></form></section></div>}
    {repayId&&selectedRepayEntry&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setRepayId('');}}><section className="modal-card due-modal" role="dialog" aria-modal="true" aria-labelledby="due-payment-title"><div className="modal-heading"><div><p className="eyebrow">SEPARATE PRINCIPAL LEDGER</p><h2 id="due-payment-title">{selectedRepayEntry.direction==='receivable'?'Record collection':'Record repayment'}</h2><p>{selectedRepayEntry.person} · Outstanding {taka(outstanding(selectedRepayEntry))}</p></div><button className="icon-btn" onClick={()=>setRepayId('')} aria-label="Close"><X size={18}/></button></div><form className="due-form" onSubmit={addRepayment}><label>Amount (৳)<input type="number" min="0.01" max={outstanding(selectedRepayEntry)/100} step="0.01" value={repayAmount} onChange={e=>setRepayAmount(e.target.value)} required /></label><label>Note (optional)<input value={repayNote} onChange={e=>setRepayNote(e.target.value)} /></label><button className="primary-btn" type="submit">Save payment</button></form></section></div>}
  </div>;
}
