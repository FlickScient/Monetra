'use client';

import { useState, type ChangeEvent } from 'react';
import { financeApiFetch } from '@/lib/native-api-fetch';
import { Download, ShieldCheck, Upload } from 'lucide-react';

export function BackupControls({ workspaceId }: { workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function downloadBackup() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await financeApiFetch('/api/backup', { headers: { 'x-workspace-id': workspaceId }, cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Could not create backup.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'monetra-backup.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('Full workspace backup downloaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create backup.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 4_000_000) {
      setError('Backup file must be 4 MB or smaller.');
      return;
    }
    const confirmed = window.confirm(
      'Restore this backup into the current workspace? Restore only works in an empty workspace of the same type. Existing financial records are never overwritten.'
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage('');
    setError('');
    try {
      const contents = await file.text();
      const response = await financeApiFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: contents,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not restore this backup.');
      setMessage('Backup restored. Refreshing your workspace…');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this backup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card settings-section">
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">DATA PORTABILITY</p>
          <h2>Backup & recovery</h2>
          <p className="section-subtitle">Export a complete workspace snapshot, including wallets, transactions, debt, savings, budgets and ledger history.</p>
        </div>
        <span className="section-icon"><ShieldCheck size={18} /></span>
      </div>
      <div className="backup-actions">
        <button className="secondary-btn" type="button" onClick={() => void downloadBackup()} disabled={busy}>
          <Download size={15} /> Download full backup
        </button>
        <label className="secondary-btn backup-upload">
          <Upload size={15} /> Restore from JSON
          <input type="file" accept=".json,application/json" onChange={(event) => void restoreBackup(event)} disabled={busy} />
        </label>
      </div>
      <p className="section-subtitle">Restore is deliberately restricted to an empty workspace of the same type. It will not overwrite existing records.</p>
      {message && <p className="category-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}