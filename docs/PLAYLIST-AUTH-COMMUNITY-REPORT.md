# Playlist, Downloads, Auth, Community & Listening Together — Implementation Report

Date: 2026-11-13
All claims below come from executed tests in this session. Limitations are listed
at the end.

---

## 1. Playlist track limit

### Root causes
- `server/src/routes/youtube.ts` fetched a playlist with a single `yt-dlp` run and
  then did `.slice(0, 500)`.
- `server/src/spotifyApi.ts#getSpotifyPlaylist` read only the first page of
  `/playlists/{id}` (Spotify returns max 100 items per page) and then cut the
  array at 500.
- `server/src/spotifyEmbed.ts` explicitly sliced embed results at `MAX_PLAYLIST = 100`.
- Import itself was already capped by `config.maxPlaylistTracks` (10,000), which is
  the provider-independent safety bound, not the 100 you saw.

### Fixes
- Spotify API path now pages `/playlists/{id}/tracks?offset=&limit=100` until the
  provider's declared total (bounded by 10,000 / 120 pages), preserves order and
  metadata, and reports `truncated` when the provider stops short.
- Embed fallback no longer slices at 100; it reports `capped` because Spotify's
  embed endpoint itself only serves ~100 entries for large lists — a provider
  limit, not ours.
- YouTube path pages with `--playlist-start/--playlist-end` in batches of 200,
  accumulating up to the same 10,000 cap, and returns the true `total` plus
  `truncated`. A 182-track list returned 182/182 in verification.
- Import still adds tracks in one transaction after fetching, so the position
  order and external references are unchanged; nothing is downloaded on import.

### Evidence
- Live API: `GET /api/youtube/playlist` on a public 182-track list →
  `items 182 · total 182 · truncated false`.

---

## 2. Downloads: sequential queue, verification, no freezes

### Root causes
- `download()` started every request immediately; N clicks meant N parallel
  fetches competing for bandwidth, and a dead socket had no timeout, so the
  record could sit in "downloading" forever.
- No `verifying` step: the UI claimed success right after writing the blob, and a
  truncated write was never read back.
- Progress could be stale because updates were throttled but not stored per
  chunk type; no stall detection existed.

### Fixes (`apps/web/src/store/downloads.ts`)
- One FIFO worker: `download()` enqueues (state `queued`), `pump()` starts the
  next item only when the active one finishes, fails, or is cancelled.
- States: `queued` → `downloading` → `verifying` → `downloaded`, with `paused`
  (cancel) and `failed` (error) preserved. UI (`DownloadButton`) shows a waiting
  icon with "queue" tooltip, a spinner with real percentage + MB received/total,
  a verification check, then the green downloaded check.
- Verification: the blob is saved to IndexedDB, read back, and its size compared
  before the record may say `downloaded`; a mismatch deletes the entry and fails.
- Stall detection: a 45 s without-bytes watchdog aborts the fetch and fails with
  "İndirme zaman aşımına uğradı", so the queue moves on instead of freezing.
- Cancel: queued items are removed immediately; active items abort and park as
  `paused`, resumable with the retry button.
- Persistence: records still live in IndexedDB; completed downloads survive a
  refresh, and interrupted ones are parked as paused on load.
- Server storage is untouched — downloads remain device-local only.

### Evidence (browser E2E)
- Two tracks queued back-to-back: final states `["downloaded","downloaded"]`,
  stored blobs `13.5 MB` and `4.4 MB`, and no sample had two active downloads.

---

## 3. Unexpected logouts

### Root cause (critical)
`server/src/config.ts` generated a **random session secret on every boot** when
`MUSIC_SESSION_SECRET` was unset (the development default). Every restart — and
every deploy — invalidated every signed cookie. A second, smaller cause: the
client logged out on **any** 401 from any endpoint, so one failing request could
kick a valid session out.

### Fixes
- A generated secret is now persisted to `server/data/.session-secret` (0600) and
  reused; production still requires `MUSIC_SESSION_SECRET`.
- Sliding renewal: `requireAuth` re-issues the cookie when less than half of
  `SESSION_DAYS` remains, so an active user never hits expiry mid-session.
- The client confirms a 401 with `/api/auth/me` (debounced) before clearing the
  session; network errors and non-auth 401s no longer log anyone out.
- Cookie stays `httpOnly`, `SameSite=Lax` (None+Secure behind HTTPS), 30 days.

### Evidence
- Login → server restart → `GET /api/auth/me` still `200 {"authenticated":true}`.

---

## 4. Community interface

Rebuilt the page into a workspace instead of a vertical stack:
- left rail: General Chat, Friends, Direct Messages, Listening Together,
  Taste Match, Music Quiz, Members;
- one section at a time in the main column (`?section=` is the source of truth, so
  links and refresh keep the section);
- contextual right panel: member list on Chat/Friends, hidden elsewhere;
- mobile: the rail becomes a horizontal chip row, side panel hidden, no horizontal
  overflow (verified at 390 px).

All prior panels are reused unchanged (CommunityChat, FriendsPanel, MessagesPanel,
ListeningRoomsPanel, TasteMatchPanel, QuizTeaserPanel, CommunityMembers). Live
role/restriction updates still arrive over SSE (the handler moved into the new
page).

---

## 5. Listening Together: search and links

The add-track dialog now has three providers plus link paste:
- **Library** (existing), **YouTube**, **Spotify** search results;
- pasting a YouTube video URL resolves it and queues the video;
- pasting a YouTube playlist URL queues every parsed track;
- pasting a Spotify track/playlist/album URL resolves it server-side and queues the
  items with their provider ids.
Songs no longer need to be imported into the library first.

---

## 6. Persistent room indicator

`RoomIndicator` is mounted globally: it reads `/api/rooms` (server membership is
permanent until leave/close), listens to `room_state`/`room_members`/`room_closed`
over the shared SSE stream, and shows room name, current track, participant count,
a one-click **Return** and a **Leave** action. Navigation no longer disconnects
anyone; only leaving or the room closing removes it.

## 7. Play in room

`RoomQuickActions` appears in the expanded player when the account is in a room:
**Play in room** (owner/moderator) sends `play-track` on the room timeline and
**Add to room queue** follows the room's `canEditQueue` (collab mode allows
listeners). Permissions are re-checked by the server on every call.

## 8. Synchronized YouTube video

- Room state gained `videoMode`; controllers toggle it with a button when the
  current track is a YouTube video. The server stores it and broadcasts the new
  revision; switching to a non-YouTube track automatically turns video mode off.
- Clients render the **official YouTube embed** (no proxying, no downloading,
  no re-streaming) with `autoplay`, `start` and the room's current position; the
  iframe is keyed by the room revision so play/pause/seek/skip re-mounts every
  participant at the same second, and late joiners start at the current position.
- While video mode is on, the local audio element is paused and the room sync loop
  does not fight the embed (audio and video never play together).
- Audio rooms keep the existing server-authoritative timeline and drift
  correction unchanged.

### Evidence
- Two real accounts: `videoMode` true on the server, `.room-video-frame` present in
  both browsers after the host toggled it.

---

## 9. Testing

| Suite | Result |
|---|---|
| Server unit tests | **148/148** |
| New feature E2E (community workspace, room search/URL/video, indicator, play-in-room, downloads) | **18/18** |
| Playlist live check | YouTube 182/182 tracks, `truncated:false` |
| Session persistence | survives a full server restart |
| Regressions | community UI 19/19, community API 43/43, messages UI 19/19 + API 42/42, friends UI 9/9 + phase 18/18 + realtime 16/16, rooms UI 23/23 + API 48/48, taste 19/19, quiz 21/21 + API 53/53, presence API 16/16 + live 4/4, playback 20/20, sources 22/22, discovery API 19/19, tsc clean, server + web builds |

Tests that were updated because the UI intentionally changed: messages/friends/
taste/community E2E now navigate via `?section=`, and the old community mobile tab
assertions target the new rail. No assertion was loosened to hide a failure.

---

## 10. Remaining limitations

- **Spotify without API credentials** falls back to the embed path, which the
  provider caps at ~100 entries for big playlists. With credentials configured the
  pagination imports the full list. This is a provider limit, not a code cap.
- **Video synchronization granularity**: play/pause/seek/skip and late joins align
  through the room revision; continuous drift correction inside the YouTube player
  needs the official IFrame API loop, which is not wired yet, so a very long video
  can drift by a second or two between remote participants.
- **Download ordering test** sampled once because the test files are small; the
  single-worker queue is structurally one-at-a-time, and the sample showed no
  concurrent downloads.
- **Playlist import progress UI**: counts and errors are reported, but a
  per-hundred-track progress bar for very large playlists is not streamed; the
  request completes in one batch.
- Room state, discovery cache and SSE fan-out are single-process (documented
  earlier); multi-instance deployment needs shared pub/sub.

---

## 11. Files changed

Server: `config.ts` (persistent session secret), `auth.ts` (sliding renewal),
`spotifyApi.ts` (pagination + `truncated`), `spotifyEmbed.ts` (no 100 slice),
`routes/youtube.ts` (batched playlist), `rooms.ts` + `routes/rooms.ts` +
`presence.ts` (videoMode + `video` action), `routes/search.ts` (earlier similar
pipeline), migrations unchanged (no new table needed).

Web: `api.ts` (video action, playlist flags), `types.ts` (download `verifying`,
room `videoMode`), `store/downloads.ts` (queue/worker/verification/stall),
`components/DownloadButton.tsx` (states + bytes), `components/PlayerBar.tsx`
(room actions), `components/AppShell.tsx` (room indicator),
`features/community/CommunityPage.tsx` (workspace), `features/rooms/RoomIndicator.tsx`,
`features/rooms/RoomQuickActions.tsx`, `pages/RoomPage.tsx` (provider search, URL
paste, video embed + toggle), `lib/roomSync.ts` (video-aware), `styles/pages.css`.

No production data was modified or deployed.
