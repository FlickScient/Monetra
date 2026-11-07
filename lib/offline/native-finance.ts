import { Capacitor } from '@capacitor/core';
import { SqliteFinanceSyncStore } from './sqlite-store';
import { openNativeFinanceDatabase } from './capacitor-sqlite';
import { fetchFinanceBootstrap } from './sync-client';
import { synchronizeFinanceWorkspace } from './sync-engine';
import type { OfflineCommand } from './sync-contract';

export type CachedWorkspace = {
  id: string;
  name: string;
  type: 'personal' | 'family' | 'business';
  role: 'owner';
};

export type CachedFinanceData = {
  wallets: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
};

export function isNativeFinanceApp(): boolean {
  return Capacitor.isNativePlatform();
}

async function createStore(): Promise<SqliteFinanceSyncStore> {
  return new SqliteFinanceSyncStore(await openNativeFinanceDatabase());
}

/** List previously authenticated workspaces when the device has no connection. */
export async function listCachedNativeWorkspaces(ownerId: string): Promise<CachedWorkspace[]> {
  if (!isNativeFinanceApp()) return [];
  const store = await createStore();
  const rows = await store.listLocalWorkspaces(ownerId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.workspace_type,
    role: 'owner',
  }));
}

/**
 * Install a first snapshot once, then use the durable outbox/change feed for
 * subsequent online runs. Never replace a cache that may contain pending work.
 */
export async function syncNativeWorkspace(ownerId: string, workspaceId: string): Promise<void> {
  if (!isNativeFinanceApp()) return;
  const store = await createStore();
  const cached = await store.listLocalWorkspaces(ownerId);
  if (!cached.some((workspace) => workspace.id === workspaceId)) {
    const snapshot = await fetchFinanceBootstrap(workspaceId);
    await store.installBootstrap(ownerId, snapshot);
  }
  await synchronizeFinanceWorkspace(store, workspaceId);
}

/** Read the authoritative cached rows plus any still-pending local transactions. */
export async function readCachedNativeWorkspace(workspaceId: string): Promise<CachedFinanceData> {
  if (!isNativeFinanceApp()) throw new Error('Native local finance storage is unavailable.');
  const store = await createStore();
  const [wallets, categories, transactions] = await Promise.all([
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'wallets'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'categories'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'transactions'),
  ]);
  return { wallets, categories, transactions };
}

/** Queue an income/expense locally before acknowledging the save to the UI. */
export async function queueNativeTransaction(
  workspaceId: string,
  input: {
    operationId: string;
    walletId: string;
    transactionType: 'income' | 'expense';
    categoryId?: string | null;
    amountMinor: number;
    description: string;
    occurredAt: string;
  },
): Promise<void> {
  if (!isNativeFinanceApp()) throw new Error('Offline transaction capture requires the Monetra Android app.');
  const store = await createStore();
  const command: OfflineCommand = {
    operationId: input.operationId,
    type: 'transaction.create',
    payload: {
      walletId: input.walletId,
      transactionType: input.transactionType,
      categoryId: input.categoryId ?? null,
      amountMinor: input.amountMinor,
      description: input.description,
      occurredAt: input.occurredAt,
    },
  };
  await store.enqueueCommand(workspaceId, command);
}
