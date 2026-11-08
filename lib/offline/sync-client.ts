import type {
  FinanceSyncBootstrap,
  FinanceSyncChangesPage,
  FinanceSyncPushResponse,
  OfflineCommand,
} from './sync-contract';

export type FinanceSyncClientConfig = {
  apiBaseUrl?: string;
  getSessionToken?: () => Promise<string | null>;
};

let syncClientConfig: FinanceSyncClientConfig = {};

/** Configure the shared sync client for a native app origin. Web keeps same-origin cookies by default. */
export function configureFinanceSyncClient(config: FinanceSyncClientConfig): void {
  syncClientConfig = { ...config, apiBaseUrl: config.apiBaseUrl?.replace(/\/+$/, '') };
}

async function requestHeaders(workspaceId: string, extra?: HeadersInit): Promise<Headers> {
  if (!workspaceId.trim()) throw new Error('A workspace is required for finance sync.');
  const headers = new Headers(extra);
  headers.set('x-workspace-id', workspaceId);
  if (syncClientConfig.getSessionToken) {
    const token = await syncClientConfig.getSessionToken();
    if (!token) throw new Error('Your Monetra session expired. Sign in again to sync.');
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

function apiUrl(path: string): string {
  return syncClientConfig.apiBaseUrl ? `${syncClientConfig.apiBaseUrl}${path}` : path;
}

export class FinanceSyncHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'FinanceSyncHttpError';
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null &&
      'error' in body && typeof body.error === 'string'
      ? body.error
      : 'Finance sync request failed';
    throw new FinanceSyncHttpError(message, response.status, body);
  }
  return body as T;
}

/** Download the first consistent snapshot. Persist its cursor with the snapshot atomically. */
export async function fetchFinanceBootstrap(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<FinanceSyncBootstrap> {
  const response = await fetch(apiUrl('/api/sync/bootstrap'), {
    method: 'GET',
    headers: await requestHeaders(workspaceId),
    cache: 'no-store',
    signal,
  });
  return readResponse<FinanceSyncBootstrap>(response);
}

/** Pull changes after the last cursor committed to the local database. */
export async function pullFinanceChanges(
  workspaceId: string,
  after: string,
  limit = 200,
  signal?: AbortSignal,
): Promise<FinanceSyncChangesPage> {
  if (!/^\d+$/.test(after)) throw new Error('Invalid local finance sync cursor.');
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const response = await fetch(
    apiUrl(`/api/sync/changes?after=${encodeURIComponent(after)}&limit=${boundedLimit}`),
    {
      method: 'GET',
      headers: await requestHeaders(workspaceId),
      cache: 'no-store',
      signal,
    },
  );
  return readResponse<FinanceSyncChangesPage>(response);
}

/**
 * Submit durable outbox commands. A caller must persist each operation ID and
 * payload before invoking this function, and must retry uncertain results with
 * exactly the same IDs and payloads.
 */
export async function pushFinanceCommands(
  workspaceId: string,
  operations: OfflineCommand[],
  signal?: AbortSignal,
): Promise<FinanceSyncPushResponse> {
  if (operations.length < 1 || operations.length > 25) {
    throw new Error('A sync push must contain between 1 and 25 operations.');
  }
  const response = await fetch(apiUrl('/api/sync/push'), {
    method: 'POST',
    headers: await requestHeaders(workspaceId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ operations }),
    cache: 'no-store',
    signal,
  });
  // 207 is a valid partial result; the server includes a per-operation status.
  if (response.status === 207) {
    const body: unknown = await response.json().catch(() => null);
    if (typeof body === 'object' && body !== null && 'results' in body) {
      return body as FinanceSyncPushResponse;
    }
  }
  return readResponse<FinanceSyncPushResponse>(response);
}
