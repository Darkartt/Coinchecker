import type { Report, Watch, Alert, ScanInput, WatchInput } from '@coinchecker/shared';

export const nativeExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export interface Preferences {
  apiUrl: string;
  token?: string;
  autoDetect: boolean;
  notifications: boolean;
  lastReportId?: string;
}
const defaultUrl = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3001';
export function validateApiUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Use an HTTPS backend URL, or localhost for local development.');
  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('Use the backend origin without an API path.');
  return url.origin;
}
export async function preferences(): Promise<Preferences> {
  let stored: Partial<Preferences> | null = null;
  try {
    stored = nativeExtension
      ? (await chrome.storage.local.get('preferences')).preferences
      : JSON.parse(localStorage.getItem('coinchecker:preferences') || 'null');
  } catch {
    /* A damaged local preference record can be reset through Settings. */
  }
  return {
    apiUrl: (() => {
      try {
        return validateApiUrl(stored?.apiUrl || defaultUrl);
      } catch {
        stored = null;
        return validateApiUrl(defaultUrl);
      }
    })(),
    autoDetect: !!stored?.autoDetect,
    notifications: !!stored?.notifications,
    token: typeof stored?.token === 'string' ? stored.token : undefined,
    lastReportId: stored?.lastReportId,
  };
}
export async function savePreferences(value: Preferences) {
  if (nativeExtension) await chrome.storage.local.set({ preferences: value });
  else localStorage.setItem('coinchecker:preferences', JSON.stringify(value));
}
let connection: Promise<Preferences> | null = null;
async function connected(): Promise<Preferences> {
  if (connection) return connection;
  connection = (async () => {
    const p = await preferences();
    if (p.token) return p;
    const response = await fetch(p.apiUrl + '/api/v1/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Could not register this installation with the backend.');
    const device = await response.json();
    if (typeof device.token !== 'string' || !/^[\w-]{43}$/.test(device.token))
      throw new Error('The backend returned an invalid installation token.');
    const result = { ...p, token: device.token };
    await savePreferences(result);
    return result;
  })();
  try {
    return await connection;
  } finally {
    connection = null;
  }
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const p = await connected();
  let response: Response;
  try {
    response = await fetch(p.apiUrl + '/api/v1' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path === '/scans' ? 90000 : 15000),
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && /timeout|abort/i.test(e.name)
        ? 'The request timed out. Your earlier report is still available.'
        : 'The backend is unavailable. Check the connection in settings.',
    );
  }
  const value = await response
    .json()
    .catch(() => ({ message: 'The backend returned an unreadable response.' }));
  if (!response.ok)
    throw new ApiError(
      Array.isArray(value.message)
        ? value.message.join(' ')
        : typeof value.message === 'string'
          ? value.message
          : `Request failed (${response.status}).`,
      response.status,
    );
  return value as T;
}
export const api = {
  scan: (input: ScanInput) => request<Report>('/scans', 'POST', input),
  report: (id: string) => request<Report>(`/reports/${encodeURIComponent(id)}`),
  history: (input: ScanInput) =>
    request<Report[]>(
      '/history?' +
        new URLSearchParams({
          chainId: input.chainId,
          address: input.address,
          ...(input.pairAddress ? { pairAddress: input.pairAddress } : {}),
        }),
    ),
  watches: () => request<Watch[]>('/watches'),
  watch: (input: WatchInput) => request<Watch>('/watches', 'POST', input),
  unwatch: (id: string) => request(`/watches/${encodeURIComponent(id)}`, 'DELETE'),
  alerts: () => request<Alert[]>('/alerts'),
  readAlert: (id: string) => request(`/alerts/${encodeURIComponent(id)}`, 'PATCH', {}),
  resolve: (chainId: string, pairAddress: string) =>
    request<{
      chainId: ScanInput['chainId'];
      address: ScanInput['address'];
      pairAddress: ScanInput['address'];
      symbol: string | null;
    }>('/resolve', 'POST', { chainId, pairAddress }),
};
