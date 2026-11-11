import { getServerUrl } from './serverUrl';

export type AppLanguage = 'tr' | 'en';

const STORAGE_KEY = 'Norie.language';

function apply(language: AppLanguage): AppLanguage {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // private browsing
  }
  document.documentElement.lang = language;
  return language;
}

export function getAppLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'tr') return stored;
  } catch {
    // private browsing
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

export function setAppLanguage(language: AppLanguage): void {
  apply(language);
}

/**
 * Turkish when the visitor is in Turkey, English everywhere else.
 *
 * The country comes from the server (CDN header or IP lookup); a saved choice
 * always wins, so the setting in Preferences is sticky.
 */
export async function ensureLanguage(): Promise<AppLanguage> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'tr' || stored === 'en') {
      document.documentElement.lang = stored;
      return stored;
    }
  } catch {
    // private browsing
  }

  try {
    const response = await fetch(`${getServerUrl()}/api/locale`, { credentials: 'include' });
    if (response.ok) {
      const payload = (await response.json()) as { language?: string };
      return apply(payload.language === 'en' ? 'en' : 'tr');
    }
  } catch {
    // offline: fall through to the browser hint
  }

  return apply(navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'tr');
}

/** Inline translation: the Turkish string is the key, English is the override. */
export function t(tr: string, en: string): string {
  return getAppLanguage() === 'en' ? en : tr;
}

export function localeForLanguage(language: AppLanguage): string {
  return language === 'en' ? 'en-US' : 'tr-TR';
}
