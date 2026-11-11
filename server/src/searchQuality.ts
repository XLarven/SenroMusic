/**
 * Music result quality scoring shared by all search providers.
 *
 * YouTube search returns whatever ranks highest for the raw query, which is
 * frequently a karaoke backing track, a nightcore edit, a reaction video or a
 * 10-hour loop. This module scores candidates against the user's intent and
 * demotes the variants nobody asked for, without hiding them entirely.
 */

export type ScoredCandidate = {
  id: string;
  title: string;
  uploader?: string;
  artist?: string;
  duration: number | null;
};

/** Channel/artist name for scoring, whichever shape the provider returns. */
function channelOf(candidate: ScoredCandidate): string {
  return String(candidate.uploader ?? candidate.artist ?? '');
}

/** Hard negatives — never a studio recording of the queried song. */
const DISQUALIFYING = [
  /\bkaraoke\b/i,
  /\bkarafun\b/i,
  /\bsing[\s-]?along\b/i,
  /\binstrumental\b/i,
  /\bbacking track\b/i,
  /\bnightcore\b/i,
  /\bdaycore\b/i,
  /\bslowed\s*(reverb(ed)?|down)\b/i,
  /\breverb(ed)?\s*(slowed|speed)\b/i,
  /\bslowed\b/i,
  /\breverb(ed)?\s*\d{1,2}\s*(x|%|hours?)\b/i,
  /\b\d+\s*hours?\s*(loop|version)?\b/i,
  /\b10\s*hours?\b/i,
  /\breaction\b/i,
  /\breacts?\b/i,
  /\b8d\s*audio\b/i,
  /\bbass\s*boosted\b/i,
  /\bnight\s*drive\s*edit\b/i,
  /\bai\s*cover\b/i,
  /\b(cover)\s*by\b/i,
  /\btype\s*beat\b/i,
  /\bbeat\s*making\b/i,
  /\btutorial\b/i,
  /\bhow\s*to\s*play\b/i,
  /\bguitar\s*lesson\b/i,
  /\bpiano\s*(cover|tutorial|lesson)\b/i,
  /\b(drum|guitar|piano|bass|violin|cello|flute|sax)\s*cover\b/i,
  /\bbeginner\b/i,
  /\blesson\b/i,
  /\bchords?\b/i,
  /\bloop\b/i,
  /\borchestral\s*(version|cover)\b/i,
  /\bremake\b/i,
];

/** Softer negatives — may still be a real recording, but usually not the one intended. */
const DEMOTING = [
  /\bremix\b/i,
  /\bmashup\b/i,
  /\bflip\b/i,
  /\bsped\s*up\b/i,
  /\bspeed\s*up\b/i,
  /\bchipmunk\b/i,
  /\bparody\b/i,
  /\btribute\b/i,
  /\bcover\b/i,
  /\bunplugged\b/i,
  /\bacoustic\s*version\b/i,
  /\bextended\b/i,
  /\breprise\b/i,
  /\bteaser\b/i,
  /\bshorts?\b/i,
  /\bclip\b/i,
  /\binterview\b/i,
  /\bpodcast\b/i,
];

/** Live footage — a real performance, but never the studio recording. */
const LIVE = [/\blive\b/i, /\bconcert\b/i, /\bfestival\b/i, /\bwembley\b/i, /\bfan\s*cam\b/i, /\bsoundcheck\b/i];

/** Signals that a candidate is the canonical recording. */
const BOOSTERS = [
  /\bofficial\s*(music\s*)?(video|audio|lyric\s*video|visualizer)\b/i,
  /\bofficial\b/i,
  /\blyric\s*video\b/i,
  /\baudio\b/i,
  /\bvevo\b/i,
  /\balbum\s*version\b/i,
  /\boriginal\s*mix\b/i,
];

const TRACK_NOISE = [
  /\bofficial\s*(music\s*)?(video|audio|lyric\s*video|visualizer)\b/gi,
  /\blyric\s*video\b/gi,
  /\blyrics?\b/gi,
  /\baudio\b/gi,
  /\bvideo\b/gi,
  /\bhd\b/gi,
  /\bhq\b/gi,
  /\b4k\b/gi,
  /\bremaster(ed)?\b/gi,
  /\bexplicit\b/gi,
  /\bvisualizer\b/gi,
];

/** Lowercase, strip diacritics, drop punctuation and bracketed noise. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Title with marketing noise removed, for dedupe and lyric matching. */
export function cleanTrackTitle(value: string): string {
  let out = value;
  for (const re of TRACK_NOISE) out = out.replace(re, ' ');
  return normalizeText(out);
}

/**
 * The song name without soundtrack tags, lyric subtitles or edition notes.
 *
 * Catalogue titles arrive as `Kesariya (From "Brahmastra") - Tu Fuljhadiyo …`
 * and that whole string makes a poor query for both JioSaavn and yt-dlp: the
 * marketing tail narrows the search to nothing.
 */
export function songTitle(value: string): string {
  const trimmed = value.trim();
  const withoutBrackets = trimmed.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim();
  const beforeDash = withoutBrackets.split(/\s+[-–—]\s+/)[0]?.trim() ?? '';
  const candidate = beforeDash || withoutBrackets;
  return candidate.length >= 2 ? candidate : trimmed;
}

/** Split "Artist - Title" style uploads into their parts when present. */
export function splitArtistTitle(value: string): { artist: string | null; title: string } {
  const cleaned = value.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/g, '').trim();
  const match = cleaned.match(/^(.{2,80}?)\s+[-–—]\s+(.{1,120})$/);
  if (!match) return { artist: null, title: cleaned };
  return { artist: match[1].trim(), title: match[2].trim() };
}

/**
 * Display artist for a result. yt-dlp's flat playlist mode sometimes omits
 * both `uploader` and `channel`, so fall back to the "Artist - Title" prefix
 * before giving up on a name.
 */
export function artistOf(candidate: { title: string; uploader?: string; artist?: string }): string {
  const explicit = String(candidate.uploader ?? candidate.artist ?? '').trim();
  if (explicit) return explicit;
  return splitArtistTitle(candidate.title).artist ?? 'Unknown';
}

/** Statically scored quality; higher is better. Range is roughly -60..+45. */
export function qualityScore(candidate: ScoredCandidate): number {
  const channel = channelOf(candidate);
  const haystack = `${candidate.title} ${channel} ${normalizeText(`${candidate.title} ${channel}`)}`;
  let score = 0;

  for (const re of DISQUALIFYING) if (re.test(haystack)) score -= 60;
  for (const re of DEMOTING) if (re.test(haystack)) score -= 14;
  for (const re of LIVE) if (re.test(haystack)) score -= 22;
  for (const re of BOOSTERS) if (re.test(haystack)) score += 12;

  // A real song is minutes long, not 12 seconds and not four hours.
  if (candidate.duration !== null) {
    if (candidate.duration < 45) score -= 25;
    else if (candidate.duration > 900) score -= 20;
    else if (candidate.duration >= 90 && candidate.duration <= 600) score += 6;
  }

  // "- Topic" channels are the auto-generated official label uploads.
  if (/\s-\s*topic$/i.test(channel.trim())) score += 18;

  return score;
}

/** True for candidates that should never be offered as a song result. */
export function isDisqualified(candidate: ScoredCandidate): boolean {
  // Punctuation is normalised so "slowed/reverbed" matches the same patterns
  // as "slowed + reverb".
  const haystack = `${candidate.title} ${channelOf(candidate)} ${normalizeText(`${candidate.title} ${channelOf(candidate)}`)}`;
  if (DISQUALIFYING.some((re) => re.test(haystack))) return true;
  if (candidate.duration !== null && (candidate.duration < 30 || candidate.duration > 1200)) return true;
  return false;
}

/** Relevance of a candidate to the typed query, 0..100. */
export function relevanceScore(candidate: ScoredCandidate, query: string): number {
  const q = normalizeText(query);
  if (!q) return 50;
  const tokens = q.split(' ').filter((token) => token.length > 1);
  if (tokens.length === 0) return 50;

  const uploaderText = normalizeText(channelOf(candidate));
  const fullText = `${normalizeText(candidate.title)} ${uploaderText}`;

  // Order-insensitive token coverage. Word order in a YouTube title is
  // arbitrary ("Queen - Bohemian Rhapsody" vs "Bohemian Rhapsody - Queen Live"),
  // so substring equality of the whole query rewards the wrong upload. The raw
  // title is used rather than the artist split, because uploads like
  // "Numb (Official Music Video) – Linkin Park" put the song first.
  const covered = tokens.filter((token) => fullText.includes(token)).length;

  let score = Math.round((covered / tokens.length) * 80);

  // Prefer the exact recording over a medley, an encore cut or a compilation:
  // every extra word in the title is usually a different song attached to it.
  const titleTokens = normalizeText(candidate.title)
    .split(' ')
    .filter((token) => token.length > 1);
  const extra = titleTokens.filter((token) => !tokens.includes(token)).length;
  score += Math.max(0, 30 - extra * 5);

  const { artist, title } = splitArtistTitle(candidate.title);
  if (cleanTrackTitle(title) === q) score += 15;
  if (artist && q.includes(normalizeText(artist))) score += 5;

  return score;
}

/** Fraction of significant query tokens present in the title or channel. */
export function queryCoverage(candidate: ScoredCandidate, query: string): number {
  const tokens = normalizeText(query)
    .split(' ')
    .filter((token) => token.length > 1);
  if (tokens.length === 0) return 1;
  const haystack = `${normalizeText(candidate.title)} ${normalizeText(channelOf(candidate))}`;
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched / tokens.length;
}

/**
 * Rank and dedupe candidates for a query.
 *
 * Ordering: disqualifying variants removed, off-query results gated out when
 * `strict`, exact/near duplicates collapsed (keeping the highest quality copy),
 * then relevance + quality.
 */
export function rankCandidates<T extends ScoredCandidate>(
  items: T[],
  query: string,
  limit = 20,
  options: { strict?: boolean } = {},
): T[] {
  const strict = options.strict ?? true;
  const tokenCount = normalizeText(query).split(' ').filter((token) => token.length > 1).length;

  const usable = items.filter((item) => !isDisqualified(item));

  // A two-word song query must match most of what it asked for, otherwise
  // "bohemian rhapsody" returns every Queen upload the channel ever posted.
  // Single-word and artist queries stay permissive.
  let pool = usable;
  if (strict && tokenCount >= 2) {
    const floor = tokenCount >= 3 ? 0.75 : 0.6;
    const gated = usable.filter((item) => queryCoverage(item, query) >= floor);
    if (gated.length > 0) pool = gated;
  }

  const scored = pool
    .map((item) => ({ item, total: relevanceScore(item, query) + qualityScore(item) }))
    .sort((a, b) => b.total - a.total);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const { item } of scored) {
    const { artist, title } = splitArtistTitle(item.title);
    // Dedupe on the recording identity, not the upload id — the same song is
    // often uploaded by a label, a distributor and a fan channel.
    const identity = `${cleanTrackTitle(title)}::${normalizeText(artist ?? channelOf(item))}`;
    const loose = cleanTrackTitle(title);
    if (seen.has(identity) || seen.has(loose)) continue;
    seen.add(identity);
    seen.add(loose);
    out.push(item);
    if (out.length >= limit) break;
  }

  // If filtering removed everything, fall back to the least-bad raw ordering so
  // the user still sees results instead of an empty section.
  return out.length > 0 ? out : items.slice(0, limit);
}
