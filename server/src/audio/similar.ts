/**
 * "More like this" lookups.
 *
 * One place builds similar-track candidate lists from real YouTube search data,
 * scores them with the shared quality model, and drops anything that is not a
 * different song by a plausible artist. Autoplay, the home page and the
 * "Play similar" action all go through this module so they cannot drift apart.
 */
import { artistOf, cleanTrackTitle, normalizeText, rankCandidates, songTitle } from '../searchQuality.js';
import { searchVideoCandidates, type VideoCandidate } from './youtube.js';

export type SimilarTrack = {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number | null;
  url: string;
};
export type SimilarSeed = { title: string; artist: string; excludeVideoId?: string | null };

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 300;
const cache = new Map<string, { expires: number; items: SimilarTrack[] }>();

/** Covers, remixes and live cuts are only acceptable if the seed asked for them. */
const VARIANT = /\b(cover|remix|live|karaoke|instrumental|acoustic|sped up|slowed|nightcore|8d)\b/i;

function seedKey(seed: SimilarSeed): string {
  return `${normalizeText(seed.artist)}::${normalizeText(songTitle(seed.title))}`;
}

function toTrack(candidate: VideoCandidate): SimilarTrack {
  const artist = artistOf(candidate) || 'YouTube';
  return {
    id: `yt_${candidate.id}`,
    title: cleanTrackTitle(candidate.title) || candidate.title,
    artist,
    thumbnail: candidate.thumbnail,
    duration: candidate.duration,
    url: candidate.url,
  };
}

/**
 * Similar tracks for a seed. Returns [] when the provider is unavailable — never
 * fabricated rows, never the seed itself.
 */
export async function findSimilarTracks(seed: SimilarSeed, limit = 10): Promise<SimilarTrack[]> {
  const key = seedKey(seed);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.items.slice(0, limit);

  const artist = seed.artist.trim();
  const title = songTitle(seed.title);
  if (!artist && !title) return [];

  const queries = [
    artist ? `${artist} songs` : '',
    artist ? `${artist} mix` : '',
    `${title} ${artist}`.trim(),
  ].filter(Boolean);

  const collected: VideoCandidate[] = [];
  const seenIds = new Set<string>();
  for (const query of queries) {
    const candidates = await searchVideoCandidates(query, 10);
    for (const candidate of candidates) {
      if (seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);
      collected.push(candidate);
    }
    if (collected.length >= 24) break;
  }
  if (collected.length === 0) return [];

  const ranked = rankCandidates(collected, artist || title, Math.max(limit * 2, 12), { strict: false });
  const seedTitle = normalizeText(songTitle(seed.title));
  const seedArtist = normalizeText(artist);
  const allowVariant = VARIANT.test(seed.title);

  const out: SimilarTrack[] = [];
  const identities = new Set<string>();
  for (const candidate of ranked) {
    if (seed.excludeVideoId && candidate.id === seed.excludeVideoId) continue;
    if (!allowVariant && VARIANT.test(candidate.title)) continue;
    const track = toTrack(candidate);
    const trackTitle = normalizeText(track.title);
    if (trackTitle === seedTitle) continue;
    // Keep each recording once even when a label and a distributor both upload it.
    const identity = `${normalizeText(track.artist)}|${trackTitle}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    out.push(track);
    if (out.length >= limit) break;
  }

  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, items: out });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return out;
}

/** Test/diagnostics helper. */
export function similarCacheSize(): number {
  return cache.size;
}
