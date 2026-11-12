/**
 * Home discovery.
 *
 * Real candidates only: seeds come from the user's own history/favorites (or the
 * library for a brand-new account), candidates come from YouTube search through
 * the shared similar-track pipeline, and everything is scored, deduplicated and
 * cached. If providers are down the response is empty and marked degraded — the
 * client hides empty sections instead of inventing rows.
 */
import type { Database } from 'better-sqlite3';
import { normalizeText } from './searchQuality.js';
import { findSimilarTracks, type SimilarSeed, type SimilarTrack } from './audio/similar.js';

export type DiscoveryItem = SimilarTrack & { reason: string };
export type DiscoverySection = {
  key: 'madeForYou' | 'becauseYouListened' | 'discoverSomethingNew' | 'hiddenGems' | 'randomDiscovery';
  items: DiscoveryItem[];
  seed?: { title: string; artist: string };
  artists?: string[];
};
export type DiscoveryPayload = {
  generatedAt: string;
  personalized: boolean;
  degraded: boolean;
  sections: DiscoverySection[];
};

export type SimilarFetcher = (seed: SimilarSeed, limit: number) => Promise<SimilarTrack[]>;

type Seed = { title: string; artist: string; trackId?: string | null; reason: string };

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 200;
const cache = new Map<string, { expires: number; nonce: number; payload: DiscoveryPayload }>();
const nonces = new Map<string, number>();

function readFeedback(db: Database, userId: string): { tracks: Set<string>; artists: Set<string> } {
  const rows = db
    .prepare('SELECT kind, value FROM discovery_feedback WHERE user_id = ?')
    .all(userId) as Array<{ kind: string; value: string }>;
  const tracks = new Set<string>();
  const artists = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'track') tracks.add(row.value);
    else if (row.kind === 'artist') artists.add(row.value);
  }
  return { tracks, artists };
}

export function trackIdentity(track: { title: string; artist: string }): string {
  return `${normalizeText(track.artist)}|${normalizeText(track.title)}`;
}

/** Weighted seeds: recent listening first, then frequency, then favorites. */
function collectSeeds(db: Database, userId: string, limit = 3): { seeds: Seed[]; personalized: boolean } {
  const recent = db
    .prepare(
      `SELECT t.id, t.title, t.artist, h.played_at
       FROM listening_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ? AND h.ms_played >= 3000
       ORDER BY h.played_at DESC LIMIT 20`,
    )
    .all(userId) as Array<{ id: string; title: string; artist: string; played_at: string }>;

  const topArtists = db
    .prepare(
      `SELECT t.artist, COUNT(*) AS plays
       FROM listening_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ? AND h.ms_played >= 3000
       GROUP BY lower(t.artist)
       ORDER BY plays DESC LIMIT 5`,
    )
    .all(userId) as Array<{ artist: string; plays: number }>;

  const favoriteArtists = db
    .prepare(
      `SELECT t.artist, COUNT(*) AS count
       FROM favorites f JOIN tracks t ON t.id = f.track_id
       WHERE f.user_id = ? GROUP BY lower(t.artist) ORDER BY count DESC LIMIT 3`,
    )
    .all(userId) as Array<{ artist: string; count: number }>;

  const seeds: Seed[] = [];
  const push = (seed: Seed) => {
    const key = `${normalizeText(seed.artist)}|${normalizeText(seed.title)}`;
    if (seeds.some((entry) => `${normalizeText(entry.artist)}|${normalizeText(entry.title)}` === key)) return;
    if (seed.artist || seed.title) seeds.push(seed);
  };

  const last = recent[0];
  if (last) push({ title: last.title, artist: last.artist, trackId: last.id, reason: 'recent' });
  const top = topArtists[0]?.artist;
  if (top) push({ title: '', artist: top, reason: 'top_artist' });
  const fav = favoriteArtists[0]?.artist;
  if (fav) push({ title: '', artist: fav, reason: 'favorite' });
  if (recent[1]) push({ title: recent[1].title, artist: recent[1].artist, trackId: recent[1].id, reason: 'recent' });

  if (seeds.length > 0) return { seeds: seeds.slice(0, limit), personalized: true };

  // No listening history yet: use the library's own metadata (still real data).
  const library = db
    .prepare(
      `SELECT artist, COUNT(*) AS count FROM tracks
       GROUP BY lower(artist) ORDER BY count DESC LIMIT 3`,
    )
    .all() as Array<{ artist: string; count: number }>;
  for (const row of library) push({ title: '', artist: row.artist, reason: 'library' });
  return { seeds: seeds.slice(0, limit), personalized: false };
}

function dedupe(items: SimilarTrack[]): SimilarTrack[] {
  const seen = new Set<string>();
  const out: SimilarTrack[] = [];
  for (const item of items) {
    const identity = trackIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(item);
  }
  return out;
}

function interleave(lists: SimilarTrack[][]): SimilarTrack[] {
  const out: SimilarTrack[] = [];
  const seen = new Set<string>();
  let index = 0;
  let added = true;
  while (added && out.length < 60) {
    added = false;
    for (const list of lists) {
      const item = list[index];
      if (!item) continue;
      added = true;
      const identity = trackIdentity(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push(item);
    }
    index += 1;
  }
  return out;
}

function capPerArtist(items: SimilarTrack[], perArtist = 2, limit = 20): SimilarTrack[] {
  const counts = new Map<string, number>();
  const out: SimilarTrack[] = [];
  for (const item of items) {
    const artist = normalizeText(item.artist);
    const seen = counts.get(artist) ?? 0;
    if (seen >= perArtist) continue;
    counts.set(artist, seen + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function rotate<T>(items: T[], nonce: number): T[] {
  if (items.length === 0) return items;
  const offset = nonce % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export async function buildDiscovery(
  db: Database,
  userId: string,
  options: { refresh?: boolean; fetcher?: SimilarFetcher; now?: number } = {},
): Promise<DiscoveryPayload> {
  const now = options.now ?? Date.now();
  const cached = cache.get(userId);
  if (!options.refresh && cached && cached.expires > now) return cached.payload;

  const fetcher = options.fetcher ?? findSimilarTracks;
  const nonce = (nonces.get(userId) ?? 0) + (options.refresh ? 1 : 0);
  nonces.set(userId, nonce);

  const { seeds, personalized } = collectSeeds(db, userId);
  const feedback = readFeedback(db, userId);
  const recentTracks = db
    .prepare(
      `SELECT t.title, t.artist FROM listening_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ? AND h.played_at >= ? ORDER BY h.played_at DESC LIMIT 60`,
    )
    .all(userId, new Date(now - 7 * 86_400_000).toISOString()) as Array<{ title: string; artist: string }>;
  const recentIdentities = new Set(recentTracks.map((track) => trackIdentity(track)));

  const perSeed = await Promise.all(
    seeds.map(async (seed) => {
      try {
        const items = await fetcher({ title: seed.title, artist: seed.artist }, 12);
        return { seed, items };
      } catch {
        return { seed, items: [] as SimilarTrack[] };
      }
    }),
  );

  const allowed = (item: SimilarTrack): boolean => {
    const identity = trackIdentity(item);
    if (feedback.tracks.has(identity)) return false;
    if (feedback.artists.has(normalizeText(item.artist))) return false;
    if (recentIdentities.has(identity)) return false;
    if (seeds.some((seed) => normalizeText(seed.artist) === normalizeText(item.artist) && normalizeText(seed.title) === normalizeText(item.title))) {
      return false;
    }
    return true;
  };

  const cleaned = perSeed.map((entry) => ({
    seed: entry.seed,
    items: dedupe(entry.items.filter(allowed)),
  }));
  const anyItems = cleaned.some((entry) => entry.items.length > 0);

  const sections: DiscoverySection[] = [];
  if (anyItems) {
    const used = new Set<string>();
    const takeFresh = (items: SimilarTrack[]): SimilarTrack[] => {
      const out: SimilarTrack[] = [];
      for (const item of items) {
        const identity = trackIdentity(item);
        if (used.has(identity)) continue;
        used.add(identity);
        out.push(item);
      }
      return out;
    };

    const madeForYou: SimilarTrack[] = [];
    const first = cleaned[0];
    if (first && first.items.length > 0) {
      const because = takeFresh(first.items.slice(0, 8));
      if (because.length > 0) {
        madeForYou.push(...because);
        sections.push({
          key: 'becauseYouListened',
          seed: { title: first.seed.title, artist: first.seed.artist },
          items: because.map((item) => ({ ...item, reason: 'because' })),
        });
      }
    }

    const personalised = takeFresh(capPerArtist(interleave(cleaned.map((entry) => entry.items)), 2, 16));
    if (personalised.length > 0) {
      madeForYou.push(...personalised);
      sections.push({
        key: 'madeForYou',
        items: personalised.map((item) => ({ ...item, reason: 'personal' })),
      });
    }

    const topArtists = new Set(cleaned.slice(0, 2).map((entry) => normalizeText(entry.seed.artist)));
    const fresh = cleaned
      .flatMap((entry) => entry.items)
      .filter((item) => !topArtists.has(normalizeText(item.artist)));
    const discover = takeFresh(capPerArtist(dedupe(fresh), 2, 12));
    if (discover.length > 0) {
      sections.push({
        key: 'discoverSomethingNew',
        items: discover.map((item) => ({ ...item, reason: 'new_artist' })),
      });
    }

    const playCounts = new Map(
      (
        db
          .prepare(
            `SELECT lower(t.artist) AS artist, COUNT(*) AS plays
             FROM listening_history h JOIN tracks t ON t.id = h.track_id
             WHERE h.user_id = ? GROUP BY lower(t.artist)`,
          )
          .all(userId) as Array<{ artist: string; plays: number }>
      ).map((row) => [row.artist, row.plays]),
    );
    const gems = takeFresh(
      dedupe(cleaned.flatMap((entry) => entry.items))
        .filter((item) => (playCounts.get(normalizeText(item.artist)) ?? 0) <= 1)
        .slice(0, 10),
    );
    if (gems.length > 0) {
      sections.push({
        key: 'hiddenGems',
        items: gems.map((item) => ({ ...item, reason: 'unfamiliar_artist' })),
      });
    }

    const pool = takeFresh(dedupe(cleaned.flatMap((entry) => entry.items)));
    if (pool.length > 0) {
      sections.push({
        key: 'randomDiscovery',
        items: rotate(pool, nonce).slice(0, 10).map((item) => ({ ...item, reason: 'random' })),
      });
    }
  }

  const payload: DiscoveryPayload = {
    generatedAt: new Date(now).toISOString(),
    personalized,
    degraded: !anyItems,
    sections,
  };
  cache.set(userId, { expires: now + CACHE_TTL_MS, nonce, payload });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return payload;
}

export function recordFeedback(
  db: Database,
  userId: string,
  kind: 'track' | 'artist',
  value: string,
): { ok: true } {
  // Artist values are stored normalised so "Kite & Echo" and "kite and echo"
  // hide the same artist; track values arrive as `artist|title` identities.
  const clean = (kind === 'artist' ? normalizeText(value) : value.trim()).slice(0, 200);
  if (!clean) return { ok: true };
  db.prepare(
    `INSERT INTO discovery_feedback (user_id, kind, value, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(userId, kind, clean, new Date().toISOString());
  cache.delete(userId);
  return { ok: true };
}

export function removeFeedback(db: Database, userId: string, kind: 'track' | 'artist', value: string): void {
  db.prepare('DELETE FROM discovery_feedback WHERE user_id = ? AND kind = ? AND value = ?').run(userId, kind, value);
  cache.delete(userId);
}

export function clearDiscoveryCache(userId: string): void {
  cache.delete(userId);
}

/** Test/diagnostics helper: drops every cached build and rotation counter. */
export function resetDiscoveryCache(): void {
  cache.clear();
  nonces.clear();
}
