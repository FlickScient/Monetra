import Constants from 'expo-constants';

const API_URL =
  process.env.EXPO_PUBLIC_MONETRA_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'https://monetra-4rax.vercel.app';

export type Workspace = {
  id: string;
  name: string;
  type: 'personal' | 'family' | 'business';
  role: 'owner';
};

export type ApiError = Error & { status?: number };

export async function apiRequest<T>(
  path: string,
  token: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; workspaceId?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.workspaceId ? { 'x-workspace-id': options.workspaceId } : {}),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error(`Monetra server did not respond within ${Math.ceil(timeoutMs / 1000)} seconds. Check your connection and try again.`);
    }
    throw new Error(cause instanceof Error ? cause.message : 'Network unavailable');
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : `Monetra API request failed (${response.status})`;
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export async function apiGet<T>(path: string, token: string, workspaceId?: string): Promise<T> {
  return apiRequest<T>(path, token, { workspaceId });
}
