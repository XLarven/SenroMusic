# NorieMusic — Final Audit Report

Date: 2026-11-12
Scope: playback reliability, discovery, autoplay, quiz audio verification, social
systems, security, performance and deployment readiness.
Method: code inspection plus executed tests. Nothing below is claimed from
compilation alone; every "passed" line comes from a run recorded in this session.

---

## 1. Root causes of the playback and discovery problems

### 1.1 Local library tracks were sent through the provider resolver (critical)

`apps/web/src/lib/media.ts` built the audio URL for **every** track:

```
/api/media/stream?title=...&artist=...&duration=...
```

because it always added the metadata parameters and never checked whether the
track already had a local, playable endpoint. A library file whose
`streamUrl` is `/api/tracks/<id>/stream` was therefore re-matched on YouTube /
JioSaavn by title+artist instead of being served directly. Consequences:

- songs that existed on disk could fail with 502 (`source_unavailable`),
- a matched upload could be a different recording (karaoke, loop, cover),
- every library play cost a provider resolution round trip.

**Fix:** `mediaUrl()` now returns internal endpoints verbatim and only builds the
provider URL for genuinely remote tracks.

### 1.2 YouTube fallback took the first raw hit

`searchVideoId()` requested exactly one result and used it, with no scoring. The
top raw hit for "artist song" is frequently karaoke, a reaction or a slowed edit.
There was also no second candidate to fall back to when that upload refused to
stream.

**Fix:** `searchVideoCandidates()` returns a scored list; the resolver runs
`rankCandidates()` (disqualifying variants, relevance + quality) and tries the
best few in order.

### 1.3 No negative caching and no hard attempt timeout

A dead track was re-resolved on every retry (each costing a yt-dlp process), and
provider calls were only bounded by their own 25–120 s timeouts, so a stalled
provider could hang a request long after the user gave up.

**Fix:** 60 s negative cache keyed like the positive cache, a 22 s per-attempt
deadline, and a small bounded pause (150 ms × attempt index) between providers.
Infinite retry loops are impossible: attempts are finite and failures are cached.

### 1.4 Autoplay only ran after the queue was already empty

`extendWithSimilar` was invoked from `ended` and only when the local flag
`Norie.autoplay === 'true'`; nothing was queued in advance, so the gap between
tracks was a provider round trip, and a slow provider looked like "music
stopped".

**Fix:** a rolling prefetch runs on `timeupdate` when fewer than 25 s remain, at
most once per track, only when the queue has nothing waiting, only while playing,
never in a listening room, never with repeat-one. It **appends** to the queue and
never interrupts the current track.

### 1.5 Home page had no real discovery

The home page was built exclusively from the local library and the user's
history. A fresh account saw a static list, and even an active account never saw
music outside their own files — the "empty/abandoned" feeling in the brief.

**Fix:** a provider-backed discovery feed (section 5) with caching, feedback and
graceful degradation.

### 1.6 Playback failures were invisible

The player stored an `error` but no surface rendered it; the user saw a silent
pause.

**Fix:** the player bar now shows the reason with **Retry** and **Try next**
actions.

---

## 2. Playback fallback strategy (implemented)

Order for a known upload (`yt_…` / `youtube:<id>`):

1. YouTube direct extraction (`yt-dlp -g`), 22 s cap.
2. Piped (when `PIPED_API_URL` is configured).
3. JioSaavn by metadata.

Order for a bare song (Spotify result / imported reference):

1. JioSaavn by title+artist+duration (fast, high quality).
2. YouTube search → **ranked candidates** → first candidate that actually
   extracts an audio URL (up to 4 ranked candidates).

Every attempt has a deadline; a failed resolution writes a 60 s negative entry;
a successful one is cached until 90 s before its signed URL expires. If a cached
URL starts returning 403/404/410 the resolver invalidates it and re-resolves once
with the failed provider excluded. Local files never enter this chain at all.

Client behaviour on failure: one automatic retry with a fresh resolution
(existing logic), then a visible error with **Retry** (restarts at the current
position) and **Try next** (skips to the next playable queue item).

---

## 3. Recommendation algorithm (explainable)

Signals, all from real data:

| Signal | Source | Weight |
|---|---|---|
| Recently played track | `listening_history` (≥3 s plays) | seed #1, highest |
| Most played artist | grouped plays | seed #2 |
| Favorite artist | `favorites` join | seed #3 |
| Library artist (cold start) | `tracks` group counts | fallback seeds |
| Recent repeats | last 7 days of history | exclusion |
| Explicit feedback | `discovery_feedback` | exclusion |

Candidate generation: `findSimilarTracks()` runs real YouTube searches
(`"<artist> songs"`, `"<artist> mix"`, `"<title> <artist>"`), scores every hit
with `rankCandidates` (relevance + upload quality), drops disqualifying variants
(karaoke, loops, nightcore, 10-hour edits), drops the seed recording, drops
covers/remixes/live unless the seed itself is one, dedupes on
`normalize(artist)|normalize(title)`, and caches per seed for 10 minutes.

Ranking / assembly:

- personal relevance: seeds come from recent → frequency → favorites;
- artist affinity: at most 2 tracks per artist per section (`capPerArtist`);
- diversity: round-robin interleave across seeds (`interleave`);
- freshness: tracks heard in the last 7 days are excluded; refresh rotates the
  random section (nonce offset);
- availability: rows come from search results that carry a real video id, so a
  play attempt has a source to resolve;
- repetition penalty: global `used` set across sections — the same track never
  appears twice in one feed;
- cold start: no history → library artist seeds, `personalized: false`.

Sections shipped: **Made for you**, **Because you listened to …**, **Discover
something new**, **Hidden gems** (artists with ≤1 play), **Random discovery**
(rotated). *Popular right now* and *New releases* are **not** shipped: there is no
verifiable trending/release source in this deployment, and inventing one would
violate the brief.

Feedback: "Not interested" (track) and "Show less from this artist" are stored in
`discovery_feedback` (per user, synced across devices), applied on the next build
and optimistically removed from the current view. `undo` restores them.

Server cache: per-user payload for 5 minutes, `?refresh=1` bypasses it and
advances the rotation counter. Provider failure returns `degraded: true` with an
empty section list; the client hides empty rows and offers Retry.

---

## 4. Music Quiz audio verification (as requested)

- Quiz audio is **not** read from device-local downloads. Downloads live in the
  browser's IndexedDB (`apps/web/src/lib/localDownloads.ts`); the server cannot
  see them, and the quiz does not try to.
- Quiz previews are cut with ffmpeg from files in the server's own music
  directory (`tracks.path`), exposed only as opaque 15-minute tokens. Nothing is
  written to disk.
- Devices that never downloaded a track can still take the quiz.
- Provider previews (Spotify/Deezer/YouTube segments) are deliberately not used:
  Spotify no longer issues preview URLs to new apps, Deezer previews are licensed
  to its own player, and re-streaming arbitrary YouTube segments is outside the
  provider's terms. This limitation is real and is stated in the UI pool status
  (`previewAvailable`).
- Anti-cheat unchanged and server-authoritative: answers never in the payload
  before completion, scoring server-side, daily attempt unique per user/day,
  party answers rejected after the server clock ends.

---

## 5. Changes made in this phase

### Server

| File | Change |
|---|---|
| `server/src/audio/youtube.ts` | new `searchVideoCandidates()` (scored input), legacy `searchVideoId()` now built on it |
| `server/src/audio/resolver.ts` | 22 s attempt deadline, bounded inter-attempt pause, 60 s negative cache, ranked YouTube fallback trying up to 4 candidates, diagnostics include negative count |
| `server/src/audio/similar.ts` | new shared similar-track pipeline (queries, scoring, variant filtering, seed exclusion, dedupe, 10 min cache) |
| `server/src/routes/search.ts` | `/api/youtube/similar` now uses the shared pipeline |
| `server/src/discovery.ts` | new discovery builder + feedback + caches |
| `server/src/routes/discovery.ts` | new `/api/discovery`, `/api/discovery/similar`, `/api/discovery/feedback` |
| `server/src/migrations.ts` | migration 12: `discovery_feedback` |
| `server/src/index.ts` | registers discovery routes |

### Web

| File | Change |
|---|---|
| `apps/web/src/lib/media.ts` | **critical fix**: internal endpoints bypass the provider resolver |
| `apps/web/src/store/player.ts` | rolling autoplay prefetch, `roomMode`, `prefetchRelated` |
| `apps/web/src/pages/RoomPage.tsx` | toggles room mode so prefetch never fights the room |
| `apps/web/src/features/discovery/DiscoveryFeed.tsx` | new home feed with refresh, feedback, loading/error/degraded states |
| `apps/web/src/pages/HomePage.tsx` | renders the feed |
| `apps/web/src/components/PlayerBar.tsx` | visible playback error with Retry / Try next |
| `apps/web/src/api.ts`, `types.ts`, `styles/pages.css` | discovery types/endpoints + styles |

### APIs

- `GET /api/discovery?refresh=1` — sections, cached 5 min, `degraded` flag.
- `GET /api/discovery/similar?title=&artist=&exclude=&limit=` — scored similar
  tracks for "play similar" / autoplay.
- `POST /api/discovery/feedback` `{ kind, title, artist, undo? }` — persistent
  preference.
- `DELETE /api/discovery/feedback?kind=&title=&artist=` — remove preference.
- `/api/youtube/similar` — same response shape as before, better data.

### Database

Migration 12 only:

```sql
CREATE TABLE discovery_feedback (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,           -- 'track' | 'artist'
  value TEXT NOT NULL,          -- normalized identity
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, value)
);
CREATE INDEX idx_discovery_feedback_user ON discovery_feedback(user_id, kind);
```

---

## 6. Tests executed (all really run)

| Suite | Result |
|---|---|
| Server unit tests (`pnpm --filter @Norie/server test`) | **148/148** — 7 new discovery tests (seeds, no cross-section duplicates, cold start, feedback, cache, degraded, rotation) + existing 141 |
| Discovery/resolver API (live provider) | **19/19** — 4.1 s cold build, 8 ms cached, 53 real candidates, 15 artists, no duplicates, feedback hides on refresh, resolver HEAD 200, unresolvable → 502 with negative cache, auth |
| Discovery/home browser E2E | **11/11** — 4 real rows / 32 cards, recommended track actually plays (`paused=false`, time advancing), no "not found" banner, prefetch request fired near end, refresh, not-interested hides instantly, mobile 390 px no overflow |
| Playback regression (`e2e-media`) | **20/20** |
| Source regression (`e2e-sources`) | **22/22** |
| Social suites (previous phases, re-run this session) | community 19/19, messages 19/19, taste 19/19, rooms 23/23 + 48/48 API, quiz 21/21 + 53/53 API, presence 4/4 + 16/16 + 9/9, friends 9/9 + 18/18 + 16/16 realtime |
| TypeScript | `tsc --noEmit --noUnusedLocals` clean (web) |
| Production builds | server `tsc` OK, web Vite build OK |

Not automated this pass (manual/known): real device download/offline playback,
network drop mid-stream on a physical phone, OS-level file export.

---

## 7. Remaining limitations (honest)

1. **Provider dependency.** Discovery and remote playback depend on yt-dlp and
   (optionally) Piped/JioSaavn. When a provider is blocked or rate-limited the
   feed returns `degraded: true` and playback surfaces a retry — the app stays
   usable with the local library.
2. **No trending / new-release data.** There is no licensed, verifiable source in
   this deployment, so those sections are intentionally absent rather than faked.
3. **Discovery cache is in-process.** A multi-instance deployment needs a shared
   cache/pub-sub (Redis). Single VDS is the supported topology.
4. **Quiz pool = server music library.** Larger quizzes require adding music to
   the library, not a new provider.
5. **Autoplay quality** depends on search results; the variant filter removes the
   obvious noise (karaoke, loops, slowed) but cannot guarantee the exact studio
   master for every seed.
6. **Download storage** is per browser profile (IndexedDB); clearing site data
   removes offline files.

---

## 8. Security / privacy audit summary

Verified in code and by tests: session-cookie auth on every API, rate limits on
all write paths (friends 40/min, DM 60/min, community 20/min, quiz 90/min,
discovery 40/min, room playback 240/min), server-side authorization for friends,
blocks, DMs, rooms, quiz parties and community moderation, SQL through
prepared statements only, attachment allowlists + image host allowlist, media
proxy restricted to the resolver's own URLs (no arbitrary URL fetch), SSE
authenticated per user, presence privacy enforced server-side (invisible → offline,
activity hidden), DMs invisible to blocked pairs, quiz answers never sent early,
room state membership-checked per request. No secrets are sent to the client; keys
stay in server env.

---

## 9. Production / VDS checklist

1. **Env**: `DATA_DIR`, `MUSIC_DIR`, `PUBLIC_ORIGIN`, `SECURE_COOKIES=true`,
   session secret, optional `PIPED_API_URL`, `FFMPEG_PATH` (or python +
   `imageio-ffmpeg`), optional MySQL mirror vars.
2. **Migrations**: 1–12 apply automatically on boot; back up `library.db` before
   the first start after an upgrade (`sqlite3 library.db ".backup pre-upgrade.db"`).
3. **Backups**: nightly `sqlite3 .backup` + `data/covers` + `uploads/`; test a
   restore into a temp dir.
4. **Storage**: persistent volumes for `server/data` (DB, covers, uploads) and
   `server/music`; ffmpeg/python available to the service user.
5. **Reverse proxy / Cloudflare Tunnel**: forward `Host`, keep
   `proxy_buffering off` for `/api/presence/stream`, `proxy_read_timeout 3600s`,
   HTTPS only, `X-Forwarded-Proto https`.
6. **Health**: `GET /api/health` and `/api/media/sources` for provider status
   (cached / inflight / negative counts).
7. **Shutdown**: SIGINT/SIGTERM close the server, MySQL mirror and SQLite cleanly;
   systemd `Restart=always`.
8. **Logs**: keep the Fastify log; resolver warnings name the failing provider.
9. **Do not deploy or overwrite production data without explicit authorization.**

---

## 10. Deployment readiness

- Feature-complete for the audited scope; all automated suites above pass.
- Single-node production ready with the checklist applied.
- Known single-node assumptions documented (SSE hub, discovery cache, SQLite).
- Provider outages degrade instead of hiding failures behind fake data.
