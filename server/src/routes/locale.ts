/**
 * Language hint for first-time visitors.
 *
 * A Turkish visitor gets Turkish, everyone else gets English. Country comes from
 * a CDN header when the deployment sits behind one (Cloudflare, Vercel, Fly),
 * otherwise from a free IP lookup, and the Accept-Language header is the last
 * resort for LAN requests where the IP says nothing.
 */
import type { FastifyInstance } from 'fastify';

type LocaleResponse = { country: string | null; language: 'tr' | 'en' };

const CACHE_TTL_MS = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; value: LocaleResponse }>();
const CACHE_LIMIT = 500;

function isPrivateIp(ip: string): boolean {
  return (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('::1') ||
    ip.startsWith('fe80:') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

function countryFromHeaders(headers: Record<string, unknown>): string | null {
  const candidates = [
    headers['cf-ipcountry'],
    headers['x-vercel-ip-country'],
    headers['x-country-code'],
    headers['x-geo-country'],
  ];
  for (const raw of candidates) {
    const value = String(raw ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value;
  }
  return null;
}

function languageFromAccept(accept: string): 'tr' | 'en' | null {
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('tr')) return 'tr';
  if (first.startsWith('en')) return 'en';
  return null;
}

async function lookupCountry(ip: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=countryCode`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { countryCode?: string };
    const code = String(payload.countryCode ?? '').toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function localeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/locale', async (request): Promise<LocaleResponse> => {
    const ip = request.ip;
    const accept = String(request.headers['accept-language'] ?? '');
    const cacheKey = `${ip}|${accept}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    let country = countryFromHeaders(request.headers as Record<string, unknown>);
    if (!country && ip && !isPrivateIp(ip)) {
      country = await lookupCountry(ip);
    }

    const fromHeader = languageFromAccept(accept);
    const language: 'tr' | 'en' = country ? (country === 'TR' ? 'tr' : 'en') : (fromHeader ?? 'en');
    const value: LocaleResponse = { country, language };

    cache.set(cacheKey, { at: Date.now(), value });
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return value;
  });
}
