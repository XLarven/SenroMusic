/**
 * JioSaavn audio source.
 *
 * The public web client talks to `api.php`, which returns song metadata plus a
 * DES-encrypted media path. Decrypting it yields a CDN URL that serves AAC with
 * byte ranges, so it streams and seeks exactly like a local file.
 *
 * OpenSSL 3 dropped single DES from the default provider, so the decrypt runs
 * as 3DES with K1 = K2 = K3: D(K)E(K)D(K) == D(K).
 */
import crypto from 'node:crypto';
import {
  cleanTrackTitle,
  isDisqualified,
  normalizeText,
  songTitle,
  type ScoredCandidate,
} from '../searchQuality.js';
import { BROWSER_UA, type ResolvedStream } from './types.js';

const MEDIA_KEY = Buffer.from('38346591', 'utf8');
const TRIPLE_KEY = Buffer.concat([MEDIA_KEY, MEDIA_KEY, MEDIA_KEY]);
const API = 'https://www.jiosaavn.com/api.php';

/** Versions of a song that are never the recording the user asked for. */
const VARIANT =
  /\b(techno|lofi|lo-fi|trap|drill|8d|8-bit|8bit|remix|remixed|rework|cover|karaoke|instrumental|mashup|medley|reverb|slowed|sped\s*up|speed\s*up|spedup|hyperpop|ringtone|nightcore|daycore|reprise|acoustic|unplugged|live|tribute|flip|dj|dance\s*mix|club\s*mix|extended\s*mix|radio\s*edit|female|male|tiktok|shorts|challenge)\b/i;

/** Text of the title the user did not ask for: bracketed notes plus leftover words. */
function variantScope(title: string, wantedTitle: string): string {
  const bracketed = [...title.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .join(' ');
  const wanted = new Set(normalizeText(wantedTitle).split(' ').filter(Boolean));
  const outside = normalizeText(title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
    .split(' ')
    .filter((token) => token.length > 1 && !wanted.has(token))
    .join(' ');
  return `${bracketed} ${outside}`.trim();
}

/**
 * True when the title names a different recording than the one requested:
 * a remix, a slowed edit, a cover, a festival push. The markers are matched
 * against the parts of the title the user did *not* ask for (brackets plus
 * leftover words), because an official release often carries a decorative
 * subtitle in brackets — "Kesariya (Tu Fuljhadiyo Wale Tyohaaro Jesi - Happy
 * Diwali)" is the master recording, not a Diwali edit.
 */
export function isVariantTitle(candidateTitle: string, wantedTitle: string): boolean {
  return VARIANT.test(variantScope(candidateTitle, wantedTitle));
}

/**
 * JioSaavn query and scoring run on `songTitle(...)`; see searchQuality.
 */
const SEARCH_LIMIT = 12;
const DURATION_TOLERANCE = 20;

type ArtistEntry = { name?: string };
type ArtistMap = {
  primary_artists?: ArtistEntry[];
  featured_artists?: ArtistEntry[];
  artists?: ArtistEntry[];
};

type RawSong = {
  id?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  perma_url?: string;
  more_info?: {
    duration?: string;
    encrypted_media_url?: string;
    album?: string;
    music?: string;
    label?: string;
    '320kbps'?: string;
    artistMap?: ArtistMap;
  };
};

type Candidate = {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration: number | null;
  encrypted: string;
  image: string | null;
  bitrate320: boolean;
};

function decryptMedia(encrypted: string): string | null {
  try {
    const decipher = crypto.createDecipheriv('des-ede3', TRIPLE_KEY, null);
    decipher.setAutoPadding(true);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    if (!/^https?:\/\//.test(plain)) return null;
    return plain.replace(/^http:\/\//, 'https://');
  } catch {
    return null;
  }
}

function artistNames(song: RawSong): string[] {
  const map = song.more_info?.artistMap;
  const names = [
    ...(map?.primary_artists ?? []),
    ...(map?.featured_artists ?? []),
  ]
    .map((entry) => String(entry?.name ?? '').trim())
    .filter(Boolean);

  if (names.length > 0) return [...new Set(names)];

  const music = String(song.more_info?.music ?? '').trim();
  if (music) return [music];

  // "<artist> - <album>" style subtitle is the last resort.
  const subtitle = String(song.subtitle ?? '').split(' - ')[0]?.trim();
  return subtitle ? [subtitle] : [];
}

function toCandidate(song: RawSong): Candidate | null {
  const id = String(song.id ?? '').trim();
  const title = String(song.title ?? '').trim();
  const encrypted = String(song.more_info?.encrypted_media_url ?? '').trim();
  if (!id || !title || !encrypted) return null;

  const seconds = Number(song.more_info?.duration ?? 0);
  return {
    id,
    title,
    artists: artistNames(song),
    album: song.more_info?.album ? String(song.more_info.album) : null,
    duration: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
    encrypted,
    image: song.image ? String(song.image).replace('150x150', '500x500') : null,
    bitrate320: String(song.more_info?.['320kbps'] ?? '') === 'true',
  };
}

type Want = { title: string; artist: string | null; duration: number | null };

function coverage(haystack: string, needle: string): number {
  const tokens = normalizeText(needle)
    .split(' ')
    .filter((token) => token.length > 1);
  if (tokens.length === 0) return 1;
  const text = normalizeText(haystack);
  return tokens.filter((token) => text.includes(token)).length / tokens.length;
}

/**
 * Score a catalogue result against the track the user actually asked for.
 * Returns null when the result cannot be that recording.
 */
function scoreCandidate(candidate: Candidate, want: Want): { score: number; reason: string } | null {
  const scored: ScoredCandidate = {
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artists.join(', '),
    duration: candidate.duration,
  };
  if (isDisqualified(scored)) return { score: -1, reason: 'disqualified' };
  if (isVariantTitle(candidate.title, want.title)) return { score: -1, reason: 'variant' };

  // Bracketed marketing notes ("From \"Brahmastra\"", "Official Audio") are
  // not extra songs; only words outside the brackets make the title a
  // different piece of music.
  const titleCoverage = coverage(candidate.title, want.title);
  const wantedTitle = normalizeText(want.title);
  const outsideTitle = normalizeText(candidate.title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
  const extra = outsideTitle
    .split(' ')
    .filter((token) => token.length > 1 && !wantedTitle.split(' ').includes(token)).length;

  if (titleCoverage < 0.7) return { score: -1, reason: 'title' };

  let score = titleCoverage * 60 - Math.max(0, extra - 1) * 6;

  if (want.artist) {
    const artistCoverage = Math.max(
      coverage(candidate.artists.join(' '), want.artist),
      coverage(candidate.album ?? '', want.artist),
    );
    if (artistCoverage < 0.4) return { score: -1, reason: 'artist' };
    score += artistCoverage * 25;
  }

  if (want.duration !== null && candidate.duration !== null) {
    const delta = Math.abs(candidate.duration - want.duration);
    if (delta > DURATION_TOLERANCE) return { score: -1, reason: 'duration' };
    score -= delta * 1.5;
  }

  // Exact title match, ignoring brackets and marketing noise.
  if (cleanTrackTitle(candidate.title) === wantedTitle) score += 10;
  if (candidate.bitrate320) score += 4;

  return { score, reason: 'ok' };
}

async function search(query: string): Promise<Candidate[]> {
  const url = new URL(API);
  url.searchParams.set('__call', 'search.getResults');
  url.searchParams.set('_format', 'json');
  url.searchParams.set('_marker', '0');
  url.searchParams.set('api_version', '4');
  url.searchParams.set('ctx', 'web6dot0');
  url.searchParams.set('q', query.slice(0, 160));
  url.searchParams.set('p', '1');
  url.searchParams.set('n', String(SEARCH_LIMIT));

  const res = await fetch(url, {
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'application/json',
      referer: 'https://www.jiosaavn.com/',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];

  const payload = (await res.json().catch(() => null)) as { results?: RawSong[] } | null;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map(toCandidate).filter((candidate): candidate is Candidate => candidate !== null);
}

/** Resolve a catalogue track (Spotify metadata) to a playable AAC stream. */
export async function resolveByMetadata(want: Want): Promise<ResolvedStream | null> {
  const fullTitle = want.title?.trim();
  if (!fullTitle) return null;

  // Search and score on the song name only: the soundtrack tag after it is
  // noise to the catalogue and to the token coverage check.
  const title = songTitle(fullTitle);
  const query = [want.artist, title].filter(Boolean).join(' ').trim();
  const candidates = await search(query);
  if (candidates.length === 0) return null;

  let best: { candidate: Candidate; score: number } | null = null;
  for (const candidate of candidates) {
    const verdict = scoreCandidate(candidate, { ...want, title });
    if (!verdict || verdict.score < 0) continue;
    if (!best || verdict.score > best.score) best = { candidate, score: verdict.score };
  }
  if (!best) return null;

  const decrypted = decryptMedia(best.candidate.encrypted);
  if (!decrypted) return null;

  // The API always hands out the 96 kbps path; the 320 kbps file sits next to it.
  const url = best.candidate.bitrate320 ? decrypted.replace('_96.mp4', '_320.mp4') : decrypted;

  return {
    source: 'jiosaavn',
    url,
    mimeType: 'audio/mp4',
    bitrate: best.candidate.bitrate320 ? 320_000 : 96_000,
    contentLength: null,
    expiresAt: Date.now() + 60 * 60_000,
    label: `jiosaavn:${best.candidate.id} ${best.candidate.artists.join(', ')} - ${best.candidate.title}`,
  };
}
