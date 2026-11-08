# Norie Music — Design System (v0.8)

## Palette
- Background `#111111`, Surface `#1F1F1F`, Accent `#780103`, Soft `#A23B3E`
- Text `#FFFFFF / #B3B3B3`, Border `rgba(255,255,255,0.10)`
- Font: SF Pro Display → fallback system (Inter yoksa) `-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Arial`

## Glass (kontrollü)
`nm-glass`: `rgba(31,31,31,0.62) + blur(18px) saturate(135%) + 1px border`. Yalnızca nav, player, queue, modal, search panel. Listeler opak.

## Bileşenler (`apps/web/src/components/norie/`)
- `NMButton` (primary/secondary/glass)
- `NMGlassSurface`
- `NMInput`, `NMSearchBar`, `NMToggle`, `NMSlider`
- Mevcut `AlbumCard/TrackList/PlayButton` yeni paletle aynı kalıyor (CSS override)
- `NMLyricsPanel` (`useLyrics` → lrclib.net, senkron satırlar tıklanabilir, statik fallback)

## Kaynaklar
- Ana sayfa: selamlama + arama + hero (featured albüm) + New Releases yatay carousel
- Search: YouTube her zaman + Spotify import
- Library/Playlist: büyük kapak, tutarlı radius (18px)
- Login/Register: siyah merkez, koyu input, crimson buton, minimal hata
- Player: mini glass bar + tam ekran sheet (büyük kapak, heart, progress, lyrics)

## Backend gerektiren eksikler
- **Avatar upload:** `users.avatar_url` kolonu + `/api/auth/avatar` (multer) gerekli — şu an UI'da placeholder.
- **Abonelik:** payment entegrasyonu yok — UI yalnızca bilgi.
- **Notifications:** push (VAPID) veya WebSocket altyapısı yok.
- **Audio Quality / Crossfade / Volume Normalization:** WebAudio EQ gerekir — mevcut `<audio>` elementiyle yapılmadı.
- **Connected Devices:** çoklu oturum listesi için `sessions` tablosu (token jti) gerekir.
- **Lyrics zamanlama:** lrclib senkron sözler varsa kullanılır; yoksa statik gösterilir, uydurma zaman yok.
