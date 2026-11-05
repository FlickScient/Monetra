'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dhakaMonthStart } from '@/lib/dhaka-time';
import { Download, Printer, RefreshCw } from 'lucide-react';

type ReportPayload = {
  period: 'month' | 'year';
  value: string;
  from: string;
  to: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  transactionCount: number;
  series: { label: string; incomeMinor: number; expenseMinor: number; count: number }[];
  categories: { id: string | null; name: string; totalMinor: number; count: number }[];
};

const money = (minor: number) => new Intl.NumberFormat('en-BD', {
  style: 'currency', currency: 'BDT', maximumFractionDigits: 0,
}).format(minor / 100);
const currentMonth = () => dhakaMonthStart().slice(0, 7);
const currentYear = () => currentMonth().slice(0, 4);

export function ReportsView({ workspaceId }: { workspaceId: string }) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [value, setValue] = useState(currentMonth());
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/reports?period=' + period + '&value=' + value, {
        headers: { 'x-workspace-id': workspaceId },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load report.');
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load report.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, value, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const maxBar = useMemo(() => Math.max(1, ...(data?.series || []).flatMap(row => [row.incomeMinor, row.expenseMinor])), [data]);
  const maxCategory = useMemo(() => Math.max(1, ...(data?.categories || []).map(row => row.totalMinor)), [data]);

  async function exportCSV() {
    if (!data) return;
    setExporting(true);
    setError('');
    try {
      const url = '/api/transactions/export?from=' + encodeURIComponent(data.from) + '&to=' + encodeURIComponent(data.to);
      const response = await fetch(url, { headers: { 'x-workspace-id': workspaceId }, cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Could not export this report.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'monetra-' + period + '-report-' + value + '.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export this report.');
    } finally {
      setExporting(false);
    }
  }

  const title = period === 'month'
    ? new Date(value + '-01T12:00:00+06:00').toLocaleDateString('en-BD', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' })
    : value;

  return (
    <div className="page-stack module-page reports-page">
      <section className="page-intro">
        <div>
          <p className="eyebrow">YOUR FINANCIAL PERFORMANCE</p>
          <h1>Reports<span>.</span></h1>
          <p className="intro-copy">A clear summary of where your money came from and where it went.</p>
        </div>
        <div className="report-actions">
          <button className="secondary-btn" type="button" onClick={() => window.print()} disabled={!data || loading}><Printer size={15} /> Save as PDF</button>
          <button className="secondary-btn" type="button" onClick={() => void exportCSV()} disabled={!data || loading || exporting}><Download size={15} /> {exporting ? 'Preparing…' : 'Export CSV'}</button>
        </div>
      </section>

      <section className="surface-card report-controls">
        <div className="report-period-switch">
          <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => { setPeriod('month'); setValue(currentMonth()); }}>Monthly</button>
          <button type="button" className={period === 'year' ? 'active' : ''} onClick={() => { setPeriod('year'); setValue(currentYear()); }}>Yearly</button>
        </div>
        <label>{period === 'month' ? 'Select month' : 'Select year'}
          {period === 'month'
            ? <input type="month" value={value} onChange={event => setValue(event.target.value)} />
            : <select value={value} onChange={event => setValue(event.target.value)}>{Array.from({ length: 8 }, (_, index) => String(Number(currentYear()) - index)).map(year => <option key={year} value={year}>{year}</option>)}</select>}
        </label>
        <button className="icon-btn report-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh report"><RefreshCw size={16} /></button>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <section className="surface-card"><p className="section-subtitle">Preparing {title} report…</p></section> : data ? <>
        <section className="metric-grid report-metrics">
          <article className="metric-card"><div className="metric-top"><span className="metric-period">MONEY IN</span></div><p className="metric-value">{money(data.incomeMinor)}</p><p className="metric-foot">Recorded income</p></article>
          <article className="metric-card"><div className="metric-top"><span className="metric-period">MONEY OUT</span></div><p className="metric-value">{money(data.expenseMinor)}</p><p className="metric-foot">Recorded expenses</p></article>
          <article className="metric-card metric-card-accent"><div className="metric-top"><span className="metric-period">NET CASH FLOW</span></div><p className="metric-value">{money(data.netMinor)}</p><p className="metric-foot">{data.transactionCount} income/expense records</p></article>
        </section>

        <section className="surface-card report-section">
          <div className="section-heading"><div><p className="eyebrow">{title.toUpperCase()}</p><h2>{period === 'month' ? 'Daily cash flow' : 'Monthly cash flow'}</h2><p className="section-subtitle">Income and expenses across the selected period.</p></div></div>
          {data.series.length ? <div className="report-series">{data.series.map(row => <div className="report-series-row" key={row.label}>
            <span className="report-series-label">{period === 'month' ? new Date(row.label + 'T12:00:00+06:00').toLocaleDateString('en-BD', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' }) : row.label}</span>
            <div className="report-series-bars">
              <span className="report-bar income" style={{ width: Math.max(row.incomeMinor ? 1 : 0, row.incomeMinor / maxBar * 100) + '%' }} />
              <span className="report-bar expense" style={{ width: Math.max(row.expenseMinor ? 1 : 0, row.expenseMinor / maxBar * 100) + '%' }} />
            </div>
            <span className="report-series-value">{money(row.incomeMinor - row.expenseMinor)}</span>
          </div>)}</div> : <p className="section-subtitle">No income or expense records in this period.</p>}
          <div className="report-legend"><span><i className="income" /> Income</span><span><i className="expense" /> Expense</span></div>
        </section>

        <section className="surface-card report-section">
          <div className="section-heading"><div><p className="eyebrow">SPENDING BREAKDOWN</p><h2>Expenses by category</h2><p className="section-subtitle">Categories ranked by total spending.</p></div></div>
          {data.categories.length ? <div className="report-categories">{data.categories.map(category => <div className="report-category" key={category.id || category.name}>
            <div><strong>{category.name}</strong><small>{category.count} transaction{category.count === 1 ? '' : 's'}</small></div>
            <div className="report-category-total"><b>{money(category.totalMinor)}</b><span><i style={{ width: Math.max(1, category.totalMinor / maxCategory * 100) + '%' }} /></span></div>
          </div>)}</div> : <p className="section-subtitle">No categorized expenses in this period.</p>}
        </section>
        <p className="report-footnote">Reports use Bangladesh time (UTC+6). Transfers and opening-balance adjustments are excluded from income and expense totals.</p>
      </> : null}
    </div>
  );
}