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
  dueDebts: Array<Record<string, unknown>>;
  dueDebtPayments: Array<Record<string, unknown>>;
};

export function isNativeFinanceApp(): boolean {
  return Capacitor.isNativePlatform();
}

async function createStore(): Promise<SqliteFinanceSyncStore> {
  return new SqliteFinanceSyncStore(await openNativeFinanceDatabase());
}

/** List previously authenticated workspaces when the device has no connection. */
export async function getLastNativeSessionOwner(): Promise<string | null> {
  if (!isNativeFinanceApp()) return null;
  const store = await createStore();
  return store.getLastLocalSessionOwner();
}

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
  await store.rememberLocalSession(ownerId);
  await synchronizeFinanceWorkspace(store, workspaceId);
}

/** Read the authoritative cached rows plus any still-pending local transactions. */
export async function readCachedNativeWorkspace(workspaceId: string): Promise<CachedFinanceData> {
  if (!isNativeFinanceApp()) throw new Error('Native local finance storage is unavailable.');
  const store = await createStore();
  const [wallets, categories, transactions, dueDebts, dueDebtPayments] = await Promise.all([
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'wallets'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'categories'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'transactions'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'dueDebts'),
    store.listLocalRecords<Record<string, unknown>>(workspaceId, 'dueDebtPayments'),
  ]);
  return { wallets, categories, transactions, dueDebts, dueDebtPayments };
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

/** Queue a wallet-to-wallet transfer locally for retry-safe background sync. */
export async function queueNativeTransfer(
  workspaceId: string,
  input: {
    operationId: string;
    walletId: string;
    destinationWalletId: string;
    amountMinor: number;
    description?: string;
    occurredAt: string;
  },
): Promise<void> {
  if (!isNativeFinanceApp()) throw new Error('Offline transfers require the Monetra Android app.');
  const store = await createStore();
  const command: OfflineCommand = {
    operationId: input.operationId,
    type: 'transfer.create',
    payload: {
      walletId: input.walletId,
      destinationWalletId: input.destinationWalletId,
      amountMinor: input.amountMinor,
      description: input.description,
      occurredAt: input.occurredAt,
    },
  };
  await store.enqueueCommand(workspaceId, command);
}

/** Queue a debt payment locally; the server remains authoritative after sync. */
export async function queueNativeDebtPayment(
  workspaceId: string,
  input: {
    operationId: string;
    dueDebtId: string;
    amountMinor: number;
    paidAt: string;
    paymentMethod?: string | null;
    note?: string | null;
  },
): Promise<void> {
  if (!isNativeFinanceApp()) throw new Error('Offline debt payments require the Monetra Android app.');
  const store = await createStore();
  const command: OfflineCommand = {
    operationId: input.operationId,
    type: 'debt.payment',
    payload: {
      dueDebtId: input.dueDebtId,
      amountMinor: input.amountMinor,
      paidAt: input.paidAt,
      paymentMethod: input.paymentMethod ?? null,
      note: input.note ?? null,
    },
  };
  await store.enqueueCommand(workspaceId, command);
}


const PIN_ITERATIONS = 250_000;
const PIN_DIGITS = 6;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveLocalPinHash(pin: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  if (salt.length !== 16) throw new Error('The local app lock is damaged. Reconnect and set it up again.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PIN_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Set a device-local six-digit PIN. The encrypted SQLite database stores only a salted PBKDF2 hash. */
export async function setNativeAppPin(ownerId: string, pin: string): Promise<void> {
  if (!isNativeFinanceApp()) throw new Error('The local app lock is available only in Monetra Android.');
  if (!/^\\d{6}$/.test(pin)) throw new Error('Choose a six-digit PIN.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(salt);
  const hash = await deriveLocalPinHash(pin, saltHex);
  const database = await openNativeFinanceDatabase();
  await database.run(
    `INSERT INTO local_app_lock (owner_id, pin_salt, pin_hash)
     VALUES (?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       pin_salt = excluded.pin_salt,
       pin_hash = excluded.pin_hash,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [ownerId, saltHex, hash],
  );
}

export async function hasNativeAppPin(ownerId: string): Promise<boolean> {
  if (!isNativeFinanceApp()) return false;
  const database = await openNativeFinanceDatabase();
  const row = await database.get<{ owner_id: string }>(
    'SELECT owner_id FROM local_app_lock WHERE owner_id = ?',
    [ownerId],
  );
  return Boolean(row);
}

/** Verify a PIN without ever sending it to the server. */
export async function verifyNativeAppPin(ownerId: string, pin: string): Promise<boolean> {
  if (!isNativeFinanceApp() || !/^\\d{6}$/.test(pin)) return false;
  const database = await openNativeFinanceDatabase();
  const row = await database.get<{ pin_salt: string; pin_hash: string }>(
    'SELECT pin_salt, pin_hash FROM local_app_lock WHERE owner_id = ?',
    [ownerId],
  );
  if (!row) return false;
  const candidate = await deriveLocalPinHash(pin, row.pin_salt);
  if (candidate.length !== row.pin_hash.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ row.pin_hash.charCodeAt(index);
  }
  return difference === 0;
}
