import {
  pullFinanceChanges,
  pushFinanceCommands,
} from './sync-client';
import type {
  FinanceSyncChange,
  OfflineCommand,
  OfflineCommandResult,
} from './sync-contract';

/**
 * Adapter contract implemented by the native SQLite repository.
 * Every mutating method must run inside a SQLite transaction.
 */
export interface LocalFinanceSyncStore {
  withWorkspaceSyncLock<T>(workspaceId: string, work: () => Promise<T>): Promise<T>;
  recoverInterruptedPushes(workspaceId: string): Promise<void>;
  listPendingCommands(workspaceId: string, limit: number): Promise<OfflineCommand[]>;
  markCommandsProcessing(operationIds: string[]): Promise<void>;
  markCommandSynced(operationId: string, result: OfflineCommandResult): Promise<void>;
  markCommandForRetry(operationId: string, reason: string): Promise<void>;
  markCommandConflict(operationId: string, reason: string, result: OfflineCommandResult): Promise<void>;
  markCommandRejected(operationId: string, reason: string, result: OfflineCommandResult): Promise<void>;
  getPullCursor(workspaceId: string): Promise<string>;
  /** Apply all changes AND advance the cursor atomically in one SQLite transaction. */
  applyChangesAndAdvanceCursor(
    workspaceId: string,
    changes: FinanceSyncChange[],
    nextCursor: string,
  ): Promise<void>;
}

export interface FinanceSyncRunSummary {
  pushed: number;
  retried: number;
  conflicts: number;
  rejected: number;
  pulled: number;
  pages: number;
  hasMore: boolean;
}

const PUSH_BATCH_SIZE = 25;
const MAX_PULL_PAGES_PER_RUN = 20;

function resultReason(result: OfflineCommandResult): string {
  return result.error || `Server rejected operation with status ${result.status}.`;
}

async function settlePushResult(
  store: LocalFinanceSyncStore,
  result: OfflineCommandResult,
): Promise<'pushed' | 'retried' | 'conflicts' | 'rejected'> {
  if (result.ok) {
    await store.markCommandSynced(result.operationId, result);
    return 'pushed';
  }

  const reason = resultReason(result);
  if (result.status === 409) {
    await store.markCommandConflict(result.operationId, reason, result);
    return 'conflicts';
  }
  if (result.status === 400 || result.status === 403 || result.status === 404 || result.status === 422) {
    await store.markCommandRejected(result.operationId, reason, result);
    return 'rejected';
  }

  // Network/timeout, expired authentication, rate limit, and server failures
  // are retryable. Never drop an uncertain operation.
  await store.markCommandForRetry(result.operationId, reason);
  return 'retried';
}

/**
 * Push pending intents first, then pull authoritative server changes.
 * A real SQLite adapter must implement the atomic methods above; this engine
 * deliberately contains no storage implementation or optimistic ledger math.
 */
export async function synchronizeFinanceWorkspace(
  store: LocalFinanceSyncStore,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<FinanceSyncRunSummary> {
  if (!workspaceId.trim()) throw new Error('A workspace is required for finance sync.');

  return store.withWorkspaceSyncLock(workspaceId, async () => {
    await store.recoverInterruptedPushes(workspaceId);

    const summary: FinanceSyncRunSummary = {
      pushed: 0,
      retried: 0,
      conflicts: 0,
      rejected: 0,
      pulled: 0,
      pages: 0,
      hasMore: false,
    };

    while (!signal?.aborted) {
      const pending = await store.listPendingCommands(workspaceId, PUSH_BATCH_SIZE);
      if (pending.length === 0) break;

      const operationIds = pending.map((operation) => operation.operationId);
      await store.markCommandsProcessing(operationIds);

      try {
        const response = await pushFinanceCommands(workspaceId, pending, signal);
        const resultsById = new Map(response.results.map((result) => [result.operationId, result]));

        for (const operation of pending) {
          const result = resultsById.get(operation.operationId);
          if (!result) {
            await store.markCommandForRetry(
              operation.operationId,
              'The server response omitted this operation. Retry using the same operation ID.',
            );
            summary.retried += 1;
            continue;
          }
          const state = await settlePushResult(store, result);
          summary[state] += 1;
        }

        // Avoid hot-looping on commands that remain retryable after a server
        // outage or expired session. A later online/auth event should retry.
        if (response.results.every((result) => !result.ok && result.status >= 500)) break;
        if (response.results.length === 0) break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Finance sync request failed.';
        for (const operation of pending) {
          await store.markCommandForRetry(operation.operationId, reason);
          summary.retried += 1;
        }
        break;
      }
    }

    if (signal?.aborted) return summary;

    for (let pageIndex = 0; pageIndex < MAX_PULL_PAGES_PER_RUN; pageIndex += 1) {
      const cursor = await store.getPullCursor(workspaceId);
      const page = await pullFinanceChanges(workspaceId, cursor, 200, signal);
      if (page.workspaceId !== workspaceId) {
        throw new Error('The sync server returned a different workspace. Local cursor was not advanced.');
      }
      await store.applyChangesAndAdvanceCursor(workspaceId, page.changes, page.nextCursor);
      summary.pulled += page.changes.length;
      summary.pages += 1;
      summary.hasMore = page.hasMore;
      if (!page.hasMore || signal?.aborted) break;
    }

    return summary;
  });
}
