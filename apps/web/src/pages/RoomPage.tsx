import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Crown,
  Headphones,
  Loader2,
  LogOut,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Shield,
  SkipForward,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { Cover } from '../components/Cover';
import { t } from '../lib/i18n';
import { subscribeRealtime } from '../lib/presence';
import {
  beginRoomSync,
  endRoomSync,
  expectedPosition,
  setRoomControl,
  trackToRoomTrack,
  updateRoomSync,
} from '../lib/roomSync';
import { useAuthStore } from '../store/auth';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import type {
  RoomChatMessage,
  RoomDetail,
  RoomMember,
  RoomState,
  RoomTrack,
  Track,
} from '../types';

type Tab = 'queue' | 'people' | 'chat';

function roleLabel(role: RoomMember['role']): string {
  if (role === 'owner') return t('Kurucu', 'Owner');
  if (role === 'moderator') return t('Moderatör', 'Moderator');
  return t('Dinleyici', 'Listener');
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * A listening room.
 *
 * The room state is authoritative; this page renders it and turns controls into
 * API calls. Playback itself flows through the global player via roomSync, so a
 * participant can leave the page and keep listening while the room drives it.
 */
export function RoomPage() {
  const { roomId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);
  const me = useAuthStore((state) => state.user);

  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<RoomState | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [role, setRole] = useState<RoomMember['role']>('listener');
  const [chat, setChat] = useState<RoomChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [tab, setTab] = useState<Tab>('queue');
  const [joinCode, setJoinCode] = useState(params.get('code') ?? '');
  const [joining, setJoining] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitable, setInvitable] = useState<Array<{ id: string; displayName: string; username: string | null; avatarUrl: string | null }>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const chatEnd = useRef<HTMLDivElement | null>(null);
  const player = usePlayer();
  const canControl = role === 'owner' || role === 'moderator';
  const canEditQueue = canControl || detail?.room.queueMode === 'collab';
  const controller = members.find((member) => member.role === 'owner' || member.role === 'moderator') ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(
    async (autoCode?: string) => {
      setLoading(true);
      try {
        const result = await api.room(roomId);
        setDetail(result);
        setState(result.state);
        setMembers(result.members);
        setRole(result.role);
        setLoadError(null);
        beginRoomSync(result);
        const messages = await api.roomMessages(roomId).catch(() => ({ messages: [] }));
        setChat(messages.messages);
      } catch (error) {
        if (error instanceof ApiError) {
          setLoadError(error);
          if (autoCode && (error.status === 403 || error.status === 410)) {
            try {
              await api.joinRoom(roomId, autoCode);
              await load();
              return;
            } catch {
              // fall through to the join card
            }
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [roomId],
  );

  useEffect(() => {
    void load(params.get('code') ?? undefined);
    // The room owns playback while it is open, so the global bar is redundant.
    document.body.classList.add('room-mode');
    usePlayer.getState().setRoomMode(true);
    return () => {
      document.body.classList.remove('room-mode');
      usePlayer.getState().setRoomMode(false);
      endRoomSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /* ---------- realtime ---------- */
  useEffect(() => {
    if (!detail) return;
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'room_state' && event.roomId === roomId) {
        setState(event.state);
        updateRoomSync(event.state, event.at);
        return;
      }
      if (event.type === 'room_members' && event.roomId === roomId) {
        setMembers(event.members);
        const mine = event.members.find((member) => member.userId === me?.id);
        if (mine) {
          setRole(mine.role);
          setRoomControl(mine.role === 'owner' || mine.role === 'moderator');
        }
        return;
      }
      if (event.type === 'room_chat' && event.roomId === roomId) {
        setChat((previous) =>
          previous.some((message) => message.id === event.message.id)
            ? previous.map((message) => (message.id === event.message.id ? event.message : message))
            : [...previous, event.message],
        );
        return;
      }
      if (event.type === 'room_closed' && event.roomId === roomId) {
        endRoomSync();
        pushToast(t('Oda kapandı.', 'The room was closed.'), 'info');
        navigate('/rooms');
      }
    });
    return unsubscribe;
  }, [detail, me?.id, navigate, pushToast, roomId]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  const position = useMemo(() => (state ? expectedPosition(state, 0) : 0), [state, now]);
  const duration = state?.current?.track.duration ?? player.duration ?? 0;
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const playing = state?.playing ?? false;

  /* ---------- actions ---------- */

  const run = useCallback(
    async (action: () => Promise<unknown>, message?: string) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        const fallback = message ?? t('İşlem başarısız.', 'Action failed.');
        pushToast(error instanceof Error ? error.message : fallback, 'error');
      } finally {
        setBusy(false);
      }
    },
    [pushToast],
  );

  const control = useCallback(
    (action: 'play' | 'pause' | 'next', position?: number) =>
      run(
        async () => {
          const result = await api.roomPlayback(roomId, { action, position });
          setState(result.state);
          updateRoomSync(result.state, result.serverNow);
        },
        t('Oynatma komutu gönderilemedi.', 'Playback command failed.'),
      ),
    [roomId, run],
  );

  const seekTo = useCallback(
    (value: number) =>
      run(async () => {
        const result = await api.roomPlayback(roomId, { action: 'seek', position: value });
        setState(result.state);
        updateRoomSync(result.state, result.serverNow);
      }),
    [roomId, run],
  );

  const addTrack = useCallback(
    (track: RoomTrack) =>
      run(async () => {
        const result = await api.roomQueueAdd(roomId, track);
        setState(result.state);
        updateRoomSync(result.state);
        setAddOpen(false);
        setSearchText('');
      }, t('Sıraya eklenemedi.', 'Could not add to the queue.')),
    [roomId, run],
  );

  const removeAt = useCallback(
    (index: number) =>
      run(async () => {
        const result = await api.roomQueueRemove(roomId, index);
        setState(result.state);
        updateRoomSync(result.state);
      }),
    [roomId, run],
  );

  const move = useCallback(
    (from: number, to: number) =>
      run(async () => {
        const result = await api.roomQueueReorder(roomId, from, to);
        setState(result.state);
        updateRoomSync(result.state);
      }),
    [roomId, run],
  );

  const sendChat = useCallback(async () => {
    const body = chatText.trim();
    if (!body) return;
    setChatText('');
    try {
      const result = await api.roomSendMessage(roomId, body);
      setChat((previous) =>
        previous.some((message) => message.id === result.message.id) ? previous : [...previous, result.message],
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Mesaj gönderilemedi.', 'Message failed.'), 'error');
    }
  }, [chatText, pushToast, roomId]);

  const openInvite = useCallback(async () => {
    setInviteOpen(true);
    try {
      const result = await api.roomInvitable(roomId);
      setInvitable(result.friends);
    } catch {
      setInvitable([]);
    }
  }, [roomId]);

  async function joinNow() {
    setJoining(true);
    try {
      await api.joinRoom(roomId, joinCode.trim() || undefined);
      setLoadError(null);
      await load();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Odaya katılınamadı.', 'Could not join.'), 'error');
    } finally {
      setJoining(false);
    }
  }

  async function leave() {
    try {
      await api.leaveRoom(roomId);
    } catch {
      // Leaving must never trap the user in the page.
    }
    endRoomSync();
    navigate('/rooms');
  }

  const [addMode, setAddMode] = useState<'library' | 'youtube' | 'spotify'>('library');
  const [providerResults, setProviderResults] = useState<
    Array<{ id: string; title: string; artist: string; coverUrl: string | null; duration: number | null; source: string }>
  >([]);

  const searchLibrary = useCallback(
    async (value: string) => {
      setSearchText(value);
      const needle = value.trim();
      if (needle.length < 2) {
        setSearchResults([]);
        setProviderResults([]);
        return;
      }
      try {
        if (addMode === 'library') {
          const result = await api.search(needle, 8);
          setSearchResults(result.tracks);
          return;
        }
        if (addMode === 'youtube') {
          const result = await api.youtubeSearch(needle, 8);
          setProviderResults(
            result.results.map((item) => ({
              id: `yt_${item.id}`,
              title: item.title,
              artist: item.uploader,
              coverUrl: item.thumbnail,
              duration: item.duration,
              source: 'youtube',
            })),
          );
          return;
        }
        const result = await api.spotifySearch(needle, 8);
        setProviderResults(
          result.tracks.map((item) => ({
            id: `sp_${item.id}`,
            title: item.title,
            artist: item.artist,
            coverUrl: item.artworkUrl,
            duration: item.duration,
            source: 'spotify',
          })),
        );
      } catch {
        if (addMode === 'library') setSearchResults([]);
        else setProviderResults([]);
      }
    },
    [addMode],
  );

  /** Paste a Spotify/YouTube link: resolve it and queue the tracks. */
  const resolveLink = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      try {
        const youtubeVideo = /(?:youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)([\w-]{11})/.exec(value);
        const youtubeList = /[?&]list=([\w-]+)/.exec(value);
        const spotify = /open\.spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/.exec(value);

        if (youtubeList) {
          const playlist = await api.youtubePlaylist(value);
          for (const item of playlist.items) {
            await api.roomQueueAdd(roomId, {
              id: `yt_${item.id}`,
              title: item.title,
              artist: item.uploader,
              album: null,
              coverUrl: item.thumbnail,
              source: 'youtube',
              duration: item.duration,
            });
          }
          setAddOpen(false);
          setSearchText('');
          await load();
          pushToast(t(`${playlist.items.length} parça sıraya eklendi.`, `${playlist.items.length} tracks queued.`), 'success');
          return;
        }
        if (youtubeVideo) {
          const found = await api.youtubeSearch(youtubeVideo[1], 1);
          const item = found.results[0];
          if (!item) throw new Error(t('Video bulunamadı.', 'Video not found.'));
          await api.roomQueueAdd(roomId, {
            id: `yt_${item.id}`,
            title: item.title,
            artist: item.uploader,
            album: null,
            coverUrl: item.thumbnail,
            source: 'youtube',
            duration: item.duration,
          });
          setAddOpen(false);
          setSearchText('');
          await load();
          pushToast(t('Video sıraya eklendi.', 'Video queued.'), 'success');
          return;
        }
        if (spotify) {
          const resolved = await api.spotifyResolve(value);
          for (const item of resolved.items) {
            const providerId = (item.providerTrackId ?? '').replace(/[^\w-]/g, '').slice(0, 60);
            await api.roomQueueAdd(roomId, {
              id: providerId ? `sp_${providerId}` : `presence_${`${item.artist}-${item.title}`.replace(/[^\w-]+/g, '-')}`.slice(0, 60),
              title: item.title,
              artist: item.artist,
              album: item.album ?? null,
              coverUrl: item.artworkUrl ?? null,
              source: 'spotify',
              duration: item.duration ?? null,
            });
          }
          setAddOpen(false);
          setSearchText('');
          await load();
          pushToast(t(`${resolved.items.length} parça sıraya eklendi.`, `${resolved.items.length} tracks queued.`), 'success');
          return;
        }
        pushToast(t('Bu bağlantı desteklenmiyor. Spotify veya YouTube bağlantısı yapıştır.', 'Unsupported link. Paste a Spotify or YouTube link.'), 'error');
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Bağlantı çözülemedi.', 'Could not resolve the link.'), 'error');
      }
    },
    [load, pushToast, roomId],
  );

  const shareLink = useMemo(() => {
    if (!detail || typeof window === 'undefined') return '';
    const base = `${window.location.origin}/rooms/${detail.room.id}`;
    const code = detail.joinCode ?? (detail.room.visibility === 'private' ? (params.get('code') ?? '') : '');
    return code ? `${base}?code=${encodeURIComponent(code)}` : base;
  }, [detail, params]);

  if (loading) {
    return (
      <div className="page room-page">
        <div className="taste-loading">
          <Loader2 size={18} className="spin" /> {t('Oda yükleniyor', 'Loading the room')}
        </div>
      </div>
    );
  }

  if (loadError || !detail || !state) {
    const needsInvite = loadError?.status === 403;
    return (
      <div className="page room-page">
        <Link className="button ghost compact" to="/rooms">
          <ArrowLeft size={15} /> {t('Odalar', 'Rooms')}
        </Link>
        <div className="taste-blocked">
          <Headphones size={26} />
          <h2>{needsInvite ? t('Bu oda özel', 'This room is private') : t('Oda bulunamadı', 'Room not found')}</h2>
          <p>
            {needsInvite
              ? t('Girmek için davet veya bağlantı kodu gerekli.', 'An invitation or the join code is required.')
              : t('Bağlantı geçersiz olabilir.', 'The link may be invalid.')}
          </p>
          {needsInvite ? (
            <div className="room-join">
              <input
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 8))}
                placeholder={t('Kod', 'Code')}
                aria-label={t('Katılım kodu', 'Join code')}
              />
              <button type="button" className="button" onClick={() => void joinNow()} disabled={joining}>
                {joining ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                {t('Katıl', 'Join')}
              </button>
            </div>
          ) : null}
          <Link className="button ghost" to="/rooms">
            {t('Oda listesi', 'Room list')}
          </Link>
        </div>
      </div>
    );
  }

  const current = state.current;
  const videoId =
    current && state.videoMode && current.track.id.startsWith('yt_') ? current.track.id.slice(3) : null;
  const videoStart = Math.max(0, Math.floor(position));
  const videoSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=${state.playing ? 1 : 0}&start=${videoStart}&rel=0&modestbranding=1&playsinline=1`
    : null;

  return (
    <div className="page room-page">
      <header className="room-head">
        <Link className="icon-button subtle" to="/rooms" aria-label={t('Odalar', 'Rooms')}>
          <ArrowLeft size={18} />
        </Link>
        <div className="room-head-copy">
          <strong>{detail.room.name}</strong>
          <small>
            {detail.room.visibility === 'private' ? t('Özel oda', 'Private room') : t('Herkese açık', 'Public')} ·{' '}
            {detail.room.ownerName}
            {canControl ? ` · ${t('kontrol sende', 'you are in control')}` : controller ? ` · ${controller.displayName} ${t('kontrol ediyor', 'is controlling')}` : ''}
          </small>
        </div>
        <div className="room-head-actions">
          <button type="button" className="button ghost compact" onClick={() => void openInvite()}>
            <UserPlus size={15} /> {t('Davet et', 'Invite')}
          </button>
          {role === 'owner' ? (
            <button
              type="button"
              className="button ghost compact"
              onClick={() =>
                void run(async () => {
                  await api.closeRoom(roomId);
                  endRoomSync();
                  navigate('/rooms');
                })
              }
            >
              <Trash2 size={15} /> {t('Kapat', 'Close')}
            </button>
          ) : null}
          <button type="button" className="button ghost compact" onClick={() => void leave()}>
            <LogOut size={15} /> {t('Ayrıl', 'Leave')}
          </button>
        </div>
      </header>

      <div className="room-layout">
        <section className="room-stage" aria-label={t('Çalan', 'Now playing')}>
          <div className={`room-art ${state.videoMode ? 'is-video' : ''}`}>
            {state.videoMode ? (
              videoSrc ? (
                <iframe
                  key={`${state.revision}-${videoId}`}
                  src={videoSrc}
                  title={current?.track.title ?? t('YouTube', 'YouTube')}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  className="room-video-frame"
                />
              ) : (
                <p className="room-note">
                  {t('Bu parça video olarak açılamıyor; ses moduna dön.', 'This track cannot open as video; switch back to audio.')}
                </p>
              )
            ) : (
              <Cover src={current?.track.coverUrl ?? null} alt="" seed={current?.track.title ?? 'room'} iconSize={48} />
            )}
          </div>          <div className="room-track">
            <strong>{current?.track.title ?? t('Henüz şarkı yok', 'No track yet')}</strong>
            <span>{current?.track.artist ?? t('Sıradan bir şarkı ekle', 'Add something to the queue')}</span>
          </div>

          <div className="room-progress">
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              value={Math.min(position, duration || 1)}
              onChange={(event) => {
                if (!canControl) return;
                seekTo(Number(event.target.value));
              }}
              disabled={!canControl || !current}
              aria-label={t('Konum', 'Position')}
            />
            <div className="room-times">
              <span>{clockSeconds(position)}</span>
              <span>{clockSeconds(duration)}</span>
            </div>
            <div className="room-progress-bar" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="room-controls">
            <button
              type="button"
              className="icon-button"
              onClick={() => (canControl ? control('next') : pushToast(t('Kontrol odada başka birinde.', 'Playback is controlled by someone else.'), 'info'))}
              aria-label={t('Sonraki', 'Next')}
              disabled={!current || busy}
            >
              <SkipForward size={20} />
            </button>
            <button
              type="button"
              className="room-play"
              onClick={() => {
                if (!canControl) {
                  pushToast(t('Kontrol odada başka birinde.', 'Playback is controlled by someone else.'), 'info');
                  return;
                }
                control(playing ? 'pause' : 'play', position);
              }}
              aria-label={playing ? t('Duraklat', 'Pause') : t('Çal', 'Play')}
              disabled={!current || busy}
            >
              {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void openInvite()}
              aria-label={t('Davet et', 'Invite')}
            >
              <UserPlus size={18} />
            </button>
          </div>

          <p className="room-note">
            {canControl
              ? t('Bu odada oynatmayı sen yönetiyorsun.', 'You are driving playback in this room.')
              : t(
                  `Oynatmayı ${controller?.displayName ?? 'oda yöneticisi'} kontrol ediyor. Küçük kaymalar otomatik düzeltilir.`,
                  `${controller?.displayName ?? 'A room moderator'} controls playback. Small drift is corrected automatically.`,
                )}
          </p>

          {current && current.track.id.startsWith('yt_') ? (
            <button
              type="button"
              className="button ghost compact"
              disabled={!canControl || busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.roomPlayback(roomId, { action: 'video', enabled: !state.videoMode });
                  setState(result.state);
                  updateRoomSync(result.state, result.serverNow);
                })
              }
            >
              {state.videoMode ? t('Ses moduna geç', 'Switch to audio') : t('Videoyu birlikte izle', 'Watch video together')}
            </button>
          ) : null}

          <div className="room-volume">
            <button
              type="button"
              className="icon-button subtle"
              onClick={() => player.toggleMute()}
              aria-label={player.muted ? t('Sesi aç', 'Unmute') : t('Sessize al', 'Mute')}
            >
              {player.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.muted ? 0 : player.volume}
              onChange={(event) => player.setVolume(Number(event.target.value))}
              aria-label={t('Ses düzeyi', 'Volume')}
            />
          </div>

          {player.error ? (
            <div className="room-error">
              <span>{player.error}</span>
              <button
                type="button"
                className="button ghost compact"
                onClick={() => {
                  const track = player.current;
                  if (!track) return;
                  player.playFrom(track, position);
                }}
              >
                {t('Yeniden dene', 'Retry')}
              </button>
            </div>
          ) : null}

          <div className="room-tabs" role="tablist">
            {(['queue', 'people', 'chat'] as Tab[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`room-tab ${tab === key ? 'is-active' : ''}`}
                onClick={() => {
                  setTab(key);
                  if (window.matchMedia('(max-width: 980px)').matches) {
                    window.requestAnimationFrame(() => {
                      document.querySelector('.room-panels')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    });
                  }
                }}
              >
                {key === 'queue' ? t('Sıra', 'Queue') : key === 'people' ? t('Kişiler', 'People') : t('Sohbet', 'Chat')}
                {key === 'queue' && state.queue.length > 0 ? <span className="room-tab-badge">{state.queue.length}</span> : null}
                {key === 'people' ? <span className="room-tab-badge">{members.length}</span> : null}
              </button>
            ))}
          </div>

          <div className="room-panels">
            <div className={`room-panel ${tab === 'queue' ? 'is-active' : ''}`}>
              <div className="room-panel-head">
                <h3>{t('Sıradaki şarkılar', 'Up next')}</h3>
                {canEditQueue ? (
                  <button type="button" className="button ghost compact" onClick={() => setAddOpen(true)}>
                    <Plus size={14} /> {t('Ekle', 'Add')}
                  </button>
                ) : null}
              </div>
              {state.queue.length === 0 ? (
                <p className="room-note">{t('Sıra boş. Odanın akışını sen belirle.', 'The queue is empty. Set the pace.')}</p>
              ) : (
                <ul className="room-queue">
                  {state.queue.map((item, index) => (
                    <li key={`${item.track.id}-${index}`}>
                      <span className="room-queue-index">{index + 1}</span>
                      <Cover src={item.track.coverUrl} alt="" seed={item.track.title} className="room-queue-cover" iconSize={12} />
                      <div className="room-queue-copy">
                        <strong>{item.track.title}</strong>
                        <small>
                          {item.track.artist}
                          {item.addedByName ? ` · ${t('ekleyen', 'added by')} ${item.addedByName}` : ''}
                        </small>
                      </div>
                      {canEditQueue ? (
                        <div className="room-queue-actions">
                          <button
                            type="button"
                            className="icon-button subtle"
                            onClick={() => move(index, index - 1)}
                            disabled={index === 0}
                            aria-label={t('Yukarı taşı', 'Move up')}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button subtle"
                            onClick={() => move(index, index + 1)}
                            disabled={index === state.queue.length - 1}
                            aria-label={t('Aşağı taşı', 'Move down')}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button subtle"
                            onClick={() => removeAt(index)}
                            aria-label={t('Kaldır', 'Remove')}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`room-panel ${tab === 'people' ? 'is-active' : ''}`}>
              <div className="room-panel-head">
                <h3>{t('Odadakiler', 'In the room')}</h3>
                <span className="status-pill">
                  <Users size={12} /> {members.length}
                </span>
              </div>
              <ul className="room-people">
                {members.map((member) => (
                  <li key={member.userId}>
                    <Cover src={member.avatarUrl} alt="" seed={member.userId} className="room-person-avatar" iconSize={14} />
                    <div className="room-queue-copy">
                      <strong>
                        {member.displayName}
                        {member.userId === me?.id ? ` (${t('sen', 'you')})` : ''}
                      </strong>
                      <small>{roleLabel(member.role)}</small>
                    </div>
                    {member.role === 'owner' ? <Crown size={14} className="room-role-icon is-owner" /> : null}
                    {member.role === 'moderator' ? <Shield size={14} className="room-role-icon" /> : null}
                    {role === 'owner' && member.userId !== me?.id ? (
                      <div className="room-queue-actions">
                        <button
                          type="button"
                          className="button ghost compact"
                          onClick={() =>
                            void run(async () => {
                              const result = await api.roomSetRole(
                                roomId,
                                member.userId,
                                member.role === 'moderator' ? 'listener' : 'moderator',
                              );
                              setMembers(result.members);
                            })
                          }
                        >
                          {member.role === 'moderator' ? t('Yetkiyi al', 'Demote') : t('Moderatör yap', 'Make moderator')}
                        </button>
                        <button
                          type="button"
                          className="icon-button subtle"
                          onClick={() =>
                            void run(async () => {
                              const result = await api.roomKick(roomId, member.userId);
                              setMembers(result.members);
                            })
                          }
                          aria-label={t('Odadan çıkar', 'Remove from room')}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`room-panel is-chat ${tab === 'chat' ? 'is-active' : ''}`}>
              <div className="room-panel-head">
                <h3>
                  <MessageSquare size={14} /> {t('Oda sohbeti', 'Room chat')}
                </h3>
                <small>{t('Özel mesajlardan ayrı', 'Separate from DMs')}</small>
              </div>
              <div className="room-chat-list">
                {chat.length === 0 ? (
                  <p className="room-note">{t('İlk mesajı sen yaz.', 'Say something first.')}</p>
                ) : null}
                {chat.map((message) => {
                  const mine = message.userId === me?.id;
                  const author = members.find((member) => member.userId === message.userId);
                  const staff = role === 'owner' || role === 'moderator';
                  if (message.deletedAt) {
                    return (
                      <p key={message.id} className="room-chat-line is-deleted">
                        {t('Mesaj silindi', 'Message deleted')}
                      </p>
                    );
                  }
                  return (
                    <div key={message.id} className={`room-chat-line ${mine ? 'is-mine' : ''}`}>
                      <div className="room-chat-head">
                        <strong>{author?.displayName ?? t('Dinleyici', 'Listener')}</strong>
                        <time>{clock(message.createdAt)}</time>
                        {(mine || staff) ? (
                          <button
                            type="button"
                            className="icon-button subtle"
                            onClick={() =>
                              void run(async () => {
                                const result = await api.roomDeleteMessage(roomId, message.id);
                                setChat((previous) =>
                                  previous.map((entry) => (entry.id === result.message.id ? result.message : entry)),
                                );
                              })
                            }
                            aria-label={t('Sil', 'Delete')}
                          >
                            <Trash2 size={11} />
                          </button>
                        ) : null}
                      </div>
                      <p>{message.body}</p>
                    </div>
                  );
                })}
                <div ref={chatEnd} />
              </div>
              <form
                className="room-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat();
                }}
              >
                <input
                  type="text"
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value.slice(0, 1000))}
                  placeholder={t('Mesaj yaz…', 'Write a message…')}
                  aria-label={t('Oda mesajı', 'Room message')}
                  maxLength={1000}
                />
                <button type="submit" className="button" disabled={!chatText.trim()}>
                  <Send size={14} />
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>

      {addOpen ? (
        <div className="dm-picker" role="dialog" aria-modal="true" aria-label={t('Sıraya şarkı ekle', 'Add a track')}>
          <div className="dm-picker-card">
            <header>
              <h4>{t('Sıraya şarkı ekle', 'Add a track to the queue')}</h4>
              <button type="button" className="icon-button subtle" onClick={() => setAddOpen(false)} aria-label={t('Kapat', 'Close')}>
                <X size={16} />
              </button>
            </header>
            <div className="room-add">
              <div className="room-add-tabs">
                {(['library', 'youtube', 'spotify'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`taste-chip ${addMode === mode ? 'is-selected' : ''}`}
                    onClick={() => {
                      setAddMode(mode);
                      setSearchResults([]);
                      setProviderResults([]);
                      setSearchText('');
                    }}
                  >
                    {mode === 'library' ? t('Kütüphane', 'Library') : mode === 'youtube' ? 'YouTube' : 'Spotify'}
                  </button>
                ))}
              </div>
              <label className="taste-input">
                <Search size={14} />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => void searchLibrary(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && /^https?:\/\//.test(searchText.trim())) {
                      event.preventDefault();
                      void resolveLink(searchText);
                    }
                  }}
                  placeholder={
                    addMode === 'library'
                      ? t('Kütüphanede ara veya bağlantı yapıştır', 'Search the library or paste a link')
                      : addMode === 'youtube'
                        ? t('YouTube’da ara', 'Search YouTube')
                        : t('Spotify’da ara', 'Search Spotify')
                  }
                  aria-label={t('Şarkı ara', 'Search tracks')}
                />
              </label>
              {/^https?:\/\//.test(searchText.trim()) ? (
                <button type="button" className="button compact" onClick={() => void resolveLink(searchText)}>
                  {t('Bağlantıyı ekle', 'Add from link')}
                </button>
              ) : null}
              {player.current ? (
                <button
                  type="button"
                  className="dm-share-item"
                  onClick={() => addTrack(trackToRoomTrack(player.current as Track))}
                >
                  <Radio size={14} /> {t('Şu an çalanı ekle', 'Add what I am playing')}
                  <small>{player.current.title}</small>
                </button>
              ) : null}
              <div className="dm-picker-list">
                {searchResults.map((track) => (
                  <button
                    type="button"
                    key={track.id}
                    className="person-row dm-picker-row"
                    onClick={() =>
                      addTrack({
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        album: track.album || null,
                        coverUrl: track.coverUrl,
                        source: track.format ?? null,
                        duration: track.duration ?? null,
                      })
                    }
                  >
                    <Cover src={track.coverUrl} alt="" seed={track.id} className="person-avatar" iconSize={14} />
                    <span className="person-copy">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                  </button>
                ))}
                {providerResults.map((item) => (
                  <button
                    type="button"
                    key={`${item.source}-${item.id}`}
                    className="person-row dm-picker-row"
                    onClick={() =>
                      addTrack({
                        id: item.id,
                        title: item.title,
                        artist: item.artist,
                        album: null,
                        coverUrl: item.coverUrl,
                        source: item.source,
                        duration: item.duration,
                      })
                    }
                  >
                    <Cover src={item.coverUrl} alt="" seed={item.id} className="person-avatar" iconSize={14} />
                    <span className="person-copy">
                      <strong>{item.title}</strong>
                      <small>{item.artist}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {inviteOpen ? (
        <div className="dm-picker" role="dialog" aria-modal="true" aria-label={t('Davet et', 'Invite')}>
          <div className="dm-picker-card">
            <header>
              <h4>{t('Odaya davet et', 'Invite to the room')}</h4>
              <button type="button" className="icon-button subtle" onClick={() => setInviteOpen(false)} aria-label={t('Kapat', 'Close')}>
                <X size={16} />
              </button>
            </header>
            <div className="room-add">
              {shareLink ? (
                <button
                  type="button"
                  className="dm-share-item"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shareLink);
                    pushToast(t('Bağlantı kopyalandı.', 'Link copied.'), 'success');
                  }}
                >
                  <Copy size={14} /> {t('Bağlantıyı kopyala', 'Copy link')}
                  <small>{detail.joinCode ?? t('oda bağlantısı', 'room link')}</small>
                </button>
              ) : null}
              <div className="dm-picker-list">
                {invitable.length === 0 ? (
                  <p className="dm-share-hint">
                    {t('Davet edilecek arkadaş yok.', 'No friends left to invite.')}
                  </p>
                ) : (
                  invitable.map((friend) => (
                    <button
                      type="button"
                      key={friend.id}
                      className="person-row dm-picker-row"
                      onClick={() =>
                        void run(async () => {
                          await api.inviteToRoom(roomId, friend.id);
                          setInvitable((previous) => previous.filter((entry) => entry.id !== friend.id));
                          pushToast(t('Davet gönderildi.', 'Invitation sent.'), 'success');
                        })
                      }
                    >
                      <Cover src={friend.avatarUrl} alt="" seed={friend.id} className="person-avatar" iconSize={14} />
                      <span className="person-copy">
                        <strong>{friend.displayName}</strong>
                        <small>{friend.username ? `@${friend.username}` : ''}</small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function clockSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
