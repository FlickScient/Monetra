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

export async function apiGet<T>(
  path: string,
  token: string,
  workspaceId?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : `Monetra API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}