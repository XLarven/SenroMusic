import { createHmac } from 'node:crypto';

type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceKey: string;
  enabled: boolean;
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  return { url, anonKey, serviceKey, enabled: Boolean(url && anonKey) };
}

/**
 * Best-effort presence mirror to Supabase `profiles` table (id UUID = auth.users.id).
 * Requires table: public.profiles (id uuid PK, email text, display_name text, last_active_at timestamptz, updated_at timestamptz)
 * Failures are swallowed so local auth always works.
 */
export async function mirrorPresence(userId: string, email: string, displayName: string): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled || !cfg.serviceKey) return;
  // Auth users are UUIDs; local users are hex — skip mirror unless UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return;
  try {
    const now = new Date().toISOString();
    await fetch(`${cfg.url}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([{ id: userId, email, display_name: displayName, last_active_at: now, updated_at: now }]),
    });
  } catch {
    // ignore
  }
}

/**
 * Verify a Supabase JWT (e.g. after client signs in with Supabase Auth directly).
 * Returns stable hex id (first 24 hex of sha256 of sub) so local session can be issued.
 * In normal flow SenroMusic does password login server-side via Auth REST; this helper is for future mobile JWT use.
 */
export function supabaseSessionId(sub: string, secret: string): string {
  return createHmac('sha256', secret).update(sub).digest('hex').slice(0, 24);
}
