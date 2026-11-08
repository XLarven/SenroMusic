export type AppLanguage = 'tr' | 'en';

export function getAppLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem('Norie.language');
    if (stored === 'en' || stored === 'tr') return stored;
  } catch {
    // private browsing
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')
    ? 'en'
    : 'tr';
}

export function setAppLanguage(language: AppLanguage): void {
  try {
    localStorage.setItem('Norie.language', language);
  } catch {
    // private browsing
  }
  document.documentElement.lang = language;
}

export function localeForLanguage(language: AppLanguage): string {
  return language === 'en' ? 'en-US' : 'tr-TR';
}
