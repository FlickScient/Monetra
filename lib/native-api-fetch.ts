import { isNativeFinanceApp } from '@/lib/offline/native-finance';

let nativeTokenProvider: (() => Promise<string | null>) | null = null;

/** Install the active Clerk session token provider from the authenticated app shell. */
export function configureNativeApiTokenProvider(provider: () => Promise<string | null>): void {
  nativeTokenProvider = provider;
}

/** Same-origin on web; authenticated hosted API requests inside the Capacitor WebView. */
export async function financeApiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNativeFinanceApp()) return fetch(input, init);
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const base = import.meta.env.VITE_MONETRA_API_URL || 'https://monetra-4rax.vercel.app';
  const url = new URL(raw, base);
  if (!nativeTokenProvider) throw new Error('Monetra authentication is not ready.');
  const token = await nativeTokenProvider();
  if (!token) throw new Error('Your Monetra session expired. Sign in again to continue.');
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', 'Bearer ' + token);
  return fetch(url.toString(), { ...init, headers });
}
