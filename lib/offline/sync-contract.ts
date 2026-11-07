/**
 * Shared wire contract for Monetra's local-first client.
 * Keep this file free of Next.js, Clerk server, and database imports.
 */

export type SyncEntityOperation = 'upsert' | 'delete';

export interface FinanceSyncChange<T = unknown> {
  cursor: number;
  workspaceId: string;
  userId: string;
  entityType: string;
  entityId: string;
  operation: SyncEntityOperation;
  payload: T | null;
  createdAt: string;
}

export interface FinanceSyncBootstrap {
  schemaVersion: number;
  serverTime: string;
  cursor: number;
  workspace: {
    id: string;
    type: 'personal' | 'family' | 'business';
    name: string;
  };
  data: Record<string, unknown[]>;
}

export interface FinanceSyncChangesPage {
  changes: FinanceSyncChange[];
  nextCursor: number;
  hasMore: boolean;
}

export type OfflineCommand =
  | {
      operationId: string;
      type: 'transaction.create';
      payload: {
        walletId: string;
        transactionType: 'income' | 'expense';
        categoryId?: string | null;
        amountMinor: number;
        description: string;
        occurredAt: string;
      };
    }
  | {
      operationId: string;
      type: 'transfer.create';
      payload: {
        walletId: string;
        destinationWalletId: string;
        amountMinor: number;
        description?: string;
        occurredAt: string;
      };
    }
  | {
      operationId: string;
      type: 'debt.payment';
      payload: {
        dueDebtId: string;
        amountMinor: number;
        paidAt: string;
        paymentMethod?: string | null;
        note?: string | null;
      };
    };

export interface OfflineCommandResult {
  operationId: string;
  type: OfflineCommand['type'];
  ok: boolean;
  status: number;
  result?: unknown;
  error?: string;
}

export interface FinanceSyncPushResponse {
  workspaceId: string;
  results: OfflineCommandResult[];
  complete: boolean;
}

export interface LocalOutboxRecord {
  operationId: string;
  workspaceId: string;
  operationType: OfflineCommand['type'];
  payloadJson: string;
  state: 'pending' | 'processing' | 'conflict' | 'rejected';
  attemptCount: number;
  createdAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  serverResultJson: string | null;
}

/** Generate once when the user saves; persist and reuse for every retry. */
export function createOfflineOperationId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('A secure UUID generator is unavailable on this device.');
  }
  return crypto.randomUUID();
}
