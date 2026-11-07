const STORAGE_KEY = 'senro:serverUrl';

export function getServerUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^https?:\/\//i.test(stored.trim())) return stored.trim().replace(/\/+$/, '');
  } catch {
    // ignore
  }
  // Default: same origin (web/PWA production) or dev proxy
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return 'http://127.0.0.1:8787';
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('Geçerli bir http:// veya https:// adresi girin.');
  localStorage.setItem(STORAGE_KEY, trimmed);
}

export function getApiBase(): string {
  return `${getServerUrl()}/api`;
}
