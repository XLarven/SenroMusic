import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCheck,
  Headphones,
  ListMusic,
  Loader2,
  MessageSquarePlus,
  Music2,
  Pencil,
  Play,
  Search,
  Send,
  Share2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { EmptyState } from '../../components/EmptyState';
import { t } from '../../lib/i18n';
import { subscribeRealtime } from '../../lib/presence';
import { shareToTrack } from '../../lib/presenceTrack';
import { useAuthStore } from '../../store/auth';
import { usePlayer } from '../../store/player';
import { useToastStore } from '../../store/toast';
import { useFriendsPresence } from './useFriendsPresence';
import type {
  ConversationPeer,
  ConversationSummary,
  Message,
  MessageAttachment,
  PlaylistSummary,
} from '../../types';

const TRACK_ID_RE = /^(yt_[\w-]{11}|sp_[\w-]{1,80}|t_[a-f0-9]{8,32}|presence_[\w-]{1,60})$/;
const MAX_BODY = 2000;

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : `${date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString(
        undefined,
        { hour: '2-digit', minute: '2-digit' },
      )}`;
}

function trackAttachment(track: {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  format: string | null;
  duration: number | null;
}): MessageAttachment {
  const trackId = TRACK_ID_RE.test(track.id)
    ? track.id
    : `presence_${`${track.title}-${track.artist}`.replace(/[^\w-]+/g, '-')}`.slice(0, 60);
  return {
    kind: 'track',
    title: track.title.slice(0, 200),
    subtitle: track.artist.slice(0, 200),
    coverUrl: track.coverUrl ?? null,
    trackId,
    source: track.format ?? null,
  };
}

/**
 * Community → Messages.
 *
 * Desktop is a two-pane layout (threads left, conversation right); mobile shows
 * the thread list first and swaps to a full-width chat. The composer is pinned
 * above the safe area so the on-screen keyboard cannot cover it.
 */
export function MessagesPanel() {
  const myId = useAuthStore((state) => state.user?.id ?? null);
  const pushToast = useToastStore((state) => state.push);
  const playTrack = usePlayer((state) => state.playTrack);
  const nowPlaying = usePlayer((state) => state.current);
  const presence = useFriendsPresence();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [peer, setPeer] = useState<ConversationPeer | null>(null);
  const [canSend, setCanSend] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [text, setText] = useState('');
  const [draftAttachment, setDraftAttachment] = useState<MessageAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState<Array<{ id: string; displayName: string; username: string | null; avatarUrl: string | null }>>([]);

  const activeRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingSentRef = useRef(0);
  const typingTimerRef = useRef<number | null>(null);

  activeRef.current = activeId;
  conversationsRef.current = conversations;

  const loadConversations = useCallback(async () => {
    try {
      const page = await api.conversations({ limit: 50 });
      setConversations(page.items);
      setUnreadTotal(page.unreadTotal);
    } catch {
      // The list stays as it was; the panel is still usable.
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const openThread = useCallback(
    async (conversationId: string) => {
      setActiveId(conversationId);
      setThreadLoading(true);
      setMessages([]);
      setHasMore(false);
      setPeerReadAt(null);
      setPeerTyping(false);
      setEditing(null);
      setDraftAttachment(null);
      try {
        const detail = await api.conversation(conversationId);
        setPeer(detail.conversation.peer);
        setCanSend(detail.conversation.canSend);
        setMessages(detail.messages);
        setHasMore(detail.hasMore);
        setPeerReadAt(detail.peerReadAt);
        const last = detail.messages[detail.messages.length - 1];
        if (last) {
          await api.markConversationRead(conversationId, last.id).catch(() => undefined);
          setConversations((previous) =>
            previous.map((item) => (item.id === conversationId ? { ...item, unread: 0 } : item)),
          );
          setUnreadTotal((value) => Math.max(0, value));
        }
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Sohbet açılamadı.', 'Could not open the chat.'), 'error');
        setActiveId(null);
      } finally {
        setThreadLoading(false);
      }
    },
    [pushToast],
  );

  /* ---------- realtime ---------- */

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'message') {
        const isActive = event.conversationId === activeRef.current;
        if (isActive) {
          setMessages((previous) =>
            previous.some((message) => message.id === event.message.id) ? previous : [...previous, event.message],
          );
          if (event.message.senderId !== myId) {
            setPeerTyping(false);
            void api.markConversationRead(event.conversationId, event.message.id).catch(() => undefined);
            setPeerReadAt(new Date().toISOString());
          }
        } else if (event.message.senderId !== myId) {
          // Outside the open thread: a notification, never the message body.
          const name = conversationsRef.current.find((item) => item.id === event.conversationId)?.peer.displayName;
          pushToast(
            name
              ? `${name} · ${t('yeni mesaj', 'new message')}`
              : t('Yeni bir mesajın var.', 'You have a new message.'),
            'info',
          );
        }
        void loadConversations();
        return;
      }
      if (event.type === 'message_update') {
        if (event.conversationId === activeRef.current) {
          setMessages((previous) =>
            previous.map((message) => (message.id === event.message.id ? event.message : message)),
          );
        }
        void loadConversations();
        return;
      }
      if (event.type === 'typing') {
        if (event.conversationId !== activeRef.current || event.userId === myId) return;
        setPeerTyping(event.typing);
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        if (event.typing) {
          typingTimerRef.current = window.setTimeout(() => setPeerTyping(false), 5_000);
        }
        return;
      }
      if (event.type === 'read') {
        if (event.conversationId !== activeRef.current || event.userId === myId) return;
        setPeerReadAt(event.at);
      }
    });
    return () => {
      unsubscribe();
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, [myId, loadConversations, pushToast]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, peerTyping]);

  /* ---------- sending ---------- */

  const send = useCallback(async () => {
    if (!activeId || sending) return;
    const body = text.trim();
    if (!body && !draftAttachment) return;
    setSending(true);
    const clientId = crypto.randomUUID();
    try {
      const result = await api.sendMessage(activeId, {
        body,
        clientId,
        attachment: draftAttachment,
      });
      setMessages((previous) =>
        previous.some((message) => message.id === result.message.id) ? previous : [...previous, result.message],
      );
      setText('');
      setDraftAttachment(null);
      void api.sendTyping(activeId, false).catch(() => undefined);
      void loadConversations();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Mesaj gönderilemedi.', 'Message could not be sent.'), 'error');
    } finally {
      setSending(false);
    }
  }, [activeId, draftAttachment, loadConversations, pushToast, sending, text]);

  const notifyTyping = useCallback(() => {
    if (!activeId) return;
    const now = Date.now();
    if (now - typingSentRef.current < 2_500) return;
    typingSentRef.current = now;
    void api.sendTyping(activeId, true).catch(() => undefined);
  }, [activeId]);

  const loadOlder = useCallback(async () => {
    if (!activeId || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await api.conversation(activeId, messages[0]?.id ?? null, 40);
      setMessages((previous) => [...older.messages, ...previous]);
      setHasMore(older.hasMore);
    } catch {
      // Keep the current window when the older page fails.
    } finally {
      setLoadingOlder(false);
    }
  }, [activeId, loadingOlder, messages]);

  const saveEdit = useCallback(async () => {
    if (!activeId || !editing) return;
    const body = editing.body.trim();
    if (!body) return;
    try {
      const result = await api.editMessage(activeId, editing.id, body);
      setMessages((previous) =>
        previous.map((message) => (message.id === result.message.id ? result.message : message)),
      );
      setEditing(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Mesaj düzenlenemedi.', 'Message could not be edited.'), 'error');
    }
  }, [activeId, editing, pushToast]);

  const remove = useCallback(
    async (messageId: string) => {
      if (!activeId) return;
      try {
        const result = await api.deleteMessage(activeId, messageId);
        setMessages((previous) =>
          previous.map((message) => (message.id === result.message.id ? result.message : message)),
        );
        void loadConversations();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Mesaj silinemedi.', 'Message could not be deleted.'), 'error');
      }
    },
    [activeId, loadConversations, pushToast],
  );

  /* ---------- new conversation ---------- */

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    try {
      const page = await api.friends(50, 0);
      setFriends(page.friends.items);
    } catch {
      setFriends([]);
    }
  }, []);

  const startWith = useCallback(
    async (userId: string) => {
      try {
        const result = await api.openConversation(userId);
        setPickerOpen(false);
        await loadConversations();
        await openThread(result.conversationId);
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Sohbet başlatılamadı.', 'Could not start the chat.'), 'error');
      }
    },
    [loadConversations, openThread, pushToast],
  );

  const toggleShare = useCallback(async () => {
    const next = !shareOpen;
    setShareOpen(next);
    if (next && playlists === null) {
      try {
        const payload = await api.playlists();
        const seen = new Set<string>();
        const usable = payload.playlists
          .filter((item) => item.visibility === 'public' || item.isOwner)
          .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
          .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
          .slice(0, 8);
        setPlaylists(usable);
      } catch {
        setPlaylists([]);
      }
    }
  }, [playlists, shareOpen]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (item) =>
        item.peer.displayName.toLowerCase().includes(needle) ||
        (item.peer.username ?? '').toLowerCase().includes(needle),
    );
  }, [conversations, search]);

  const activePresence = peer ? presence.get(peer.id) : null;
  const activeSummary = conversations.find((item) => item.id === activeId) ?? null;

  function renderAttachment(attachment: MessageAttachment) {
    return (
      <div className={`dm-attach is-${attachment.kind}`}>
        <Cover src={attachment.coverUrl} alt="" seed={attachment.title} className="dm-attach-cover" iconSize={18} />
        <div className="dm-attach-copy">
          <small>
            {attachment.kind === 'track'
              ? t('şarkı', 'track')
              : attachment.kind === 'playlist'
                ? t('çalma listesi', 'playlist')
                : t('profil', 'profile')}
          </small>
          <strong>{attachment.title}</strong>
          {attachment.subtitle ? <span>{attachment.subtitle}</span> : null}
        </div>
        {attachment.kind === 'track' ? (
          <button
            type="button"
            className="play-button play-button-sm"
            onClick={() =>
              playTrack(
                shareToTrack({
                  trackId: attachment.trackId,
                  title: attachment.title,
                  artist: attachment.subtitle ?? '',
                  coverUrl: attachment.coverUrl,
                  source: attachment.source,
                }),
              )
            }
            aria-label={t('Çal', 'Play')}
            title={t('Çal', 'Play')}
          >
            <Play size={13} fill="currentColor" />
          </button>
        ) : attachment.kind === 'playlist' && attachment.playlistId ? (
          <Link className="dm-attach-open" to={`/playlists/${attachment.playlistId}`}>
            {t('Aç', 'Open')}
          </Link>
        ) : attachment.userId ? (
          <Link className="dm-attach-open" to={`/profile/${attachment.userId}`}>
            {t('Aç', 'Open')}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`dm-panel ${activeId ? 'has-active' : ''}`}>
      <div className="dm-layout">
        {/* ---------- thread list ---------- */}
        <aside className="dm-list" aria-label={t('Konuşmalar', 'Conversations')}>
          <header className="dm-list-head">
            <div className="dm-list-title">
              <h3>
                {t('Mesajlar', 'Messages')}
                {unreadTotal > 0 ? <span className="dm-unread-total">{unreadTotal}</span> : null}
              </h3>
              <button
                type="button"
                className="icon-button subtle"
                onClick={() => void openPicker()}
                aria-label={t('Yeni sohbet', 'New chat')}
                title={t('Yeni sohbet', 'New chat')}
              >
                <MessageSquarePlus size={17} />
              </button>
            </div>
            <label className="dm-search">
              <Search size={14} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Konuşma ara', 'Search conversations')}
                aria-label={t('Konuşma ara', 'Search conversations')}
              />
            </label>
          </header>

          <div className="dm-threads">
            {listLoading ? (
              <div className="dm-list-status">
                <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
              </div>
            ) : filtered.length === 0 ? (
              <div className="dm-list-status">
                <p>
                  {search
                    ? t('Eşleşen konuşma yok.', 'No matching conversation.')
                    : t('Henüz konuşma yok.', 'No conversations yet.')}
                </p>
                {!search ? (
                  <button type="button" className="button ghost compact" onClick={() => void openPicker()}>
                    {t('Arkadaşlarından birine yaz', 'Message a friend')}
                  </button>
                ) : null}
              </div>
            ) : (
              filtered.map((item) => {
                const live = presence.get(item.peer.id);
                const last = item.lastMessage;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`dm-thread ${item.id === activeId ? 'is-active' : ''}`}
                    onClick={() => void openThread(item.id)}
                  >
                    <span className="dm-thread-avatar">
                      <Cover src={item.peer.avatarUrl} alt="" seed={item.peer.id} className="person-avatar" iconSize={16} />
                      {live && live.status !== 'offline' ? (
                        <span className={`presence-dot-wrap is-${live.status}`} />
                      ) : null}
                    </span>
                    <span className="dm-thread-copy">
                      <strong>{item.peer.displayName}</strong>
                      <small>
                        {last
                          ? `${last.senderId === myId ? `${t('Sen', 'You')}: ` : ''}${
                              last.deleted
                                ? t('Mesaj silindi', 'Message deleted')
                                : last.body || '【…】'
                            }`
                          : t('Konuşmayı başlat', 'Start the conversation')}
                      </small>
                    </span>
                    <span className="dm-thread-meta">
                      <time>{last ? clock(last.createdAt) : ''}</time>
                      {item.unread > 0 ? <span className="dm-unread">{item.unread}</span> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ---------- conversation ---------- */}
        <section className="dm-chat" aria-label={t('Sohbet', 'Conversation')}>
          {!activeId ? (
            <div className="dm-chat-empty">
              <EmptyState
                icon={Share2}
                title={t('Bir konuşma seç', 'Pick a conversation')}
                description={t(
                  'Arkadaşlarınla birebir yazış, şarkı ve çalma listesi paylaş.',
                  'Chat one-to-one with your friends, share songs and playlists.',
                )}
                compact
              />
            </div>
          ) : (
            <>
              <header className="dm-chat-head">
                <button
                  type="button"
                  className="icon-button subtle dm-back"
                  onClick={() => setActiveId(null)}
                  aria-label={t('Geri', 'Back')}
                >
                  <ArrowLeft size={18} />
                </button>
                {peer ? (
                  <>
                    <Cover src={peer.avatarUrl} alt="" seed={peer.id} className="person-avatar" iconSize={16} />
                    <div className="dm-chat-who">
                      <Link to={peer.username ? `/u/${peer.username}` : `/profile/${peer.id}`}>
                        <strong>{peer.displayName}</strong>
                      </Link>
                      <small className={`dm-chat-status is-${activePresence?.status ?? 'offline'}`}>
                        {activePresence?.activity ? (
                          <>
                            <Headphones size={12} /> {activePresence.activity.title} · {activePresence.activity.artist}
                          </>
                        ) : activePresence?.status === 'online' ? (
                          t('Çevrimiçi', 'Online')
                        ) : activePresence?.status === 'away' ? (
                          t('Uzakta', 'Away')
                        ) : (
                          t('Çevrimdışı', 'Offline')
                        )}
                      </small>
                    </div>
                  </>
                ) : (
                  <div className="dm-chat-who">
                    <strong>{activeSummary?.peer.displayName ?? t('Sohbet', 'Conversation')}</strong>
                  </div>
                )}
              </header>

              <div className="dm-messages">
                {threadLoading ? (
                  <div className="dm-chat-empty">
                    <Loader2 size={18} className="spin" />
                  </div>
                ) : (
                  <>
                    {hasMore ? (
                      <button
                        type="button"
                        className="button ghost compact dm-older"
                        onClick={() => void loadOlder()}
                        disabled={loadingOlder}
                      >
                        {loadingOlder ? <Loader2 size={13} className="spin" /> : null}
                        {t('Eski mesajları yükle', 'Load older messages')}
                      </button>
                    ) : null}

                    {messages.length === 0 ? (
                      <p className="dm-empty-line">
                        {t('İlk mesajı sen yaz.', 'Write the first message.')}
                      </p>
                    ) : null}

                    {messages.map((message) => {
                      const mine = message.senderId === myId;
                      const read = mine && peerReadAt ? message.createdAt <= peerReadAt : false;
                      if (message.deletedAt) {
                        return (
                          <div key={message.id} className={`dm-bubble-row ${mine ? 'is-mine' : 'is-theirs'}`}>
                            <p className="dm-bubble is-deleted">{t('Bu mesaj silindi', 'This message was deleted')}</p>
                          </div>
                        );
                      }
                      return (
                        <div key={message.id} className={`dm-bubble-row ${mine ? 'is-mine' : 'is-theirs'}`}>
                          <div className="dm-bubble">
                            {editing?.id === message.id ? (
                              <div className="dm-edit">
                                <textarea
                                  value={editing.body}
                                  onChange={(event) => setEditing({ id: message.id, body: event.target.value })}
                                  rows={2}
                                  maxLength={MAX_BODY}
                                />
                                <div className="dm-edit-actions">
                                  <button type="button" className="button compact" onClick={() => void saveEdit()}>
                                    {t('Kaydet', 'Save')}
                                  </button>
                                  <button
                                    type="button"
                                    className="button ghost compact"
                                    onClick={() => setEditing(null)}
                                  >
                                    {t('Vazgeç', 'Cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {message.attachment ? renderAttachment(message.attachment) : null}
                                {message.body ? <p className="dm-text">{message.body}</p> : null}
                              </>
                            )}
                            <footer className="dm-meta">
                              <time>{clock(message.createdAt)}</time>
                              {message.editedAt ? <span>{t('düzenlendi', 'edited')}</span> : null}
                              {mine ? (
                                <span className={`dm-receipt ${read ? 'is-read' : ''}`} title={read ? t('Okundu', 'Read') : t('İletildi', 'Delivered')}>
                                  <CheckCheck size={13} />
                                </span>
                              ) : null}
                            </footer>
                            {mine && editing?.id !== message.id ? (
                              <div className="dm-actions">
                                {message.body ? (
                                  <button
                                    type="button"
                                    className="icon-button subtle"
                                    onClick={() => setEditing({ id: message.id, body: message.body })}
                                    aria-label={t('Düzenle', 'Edit')}
                                    title={t('Düzenle', 'Edit')}
                                  >
                                    <Pencil size={12} />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="icon-button subtle"
                                  onClick={() => void remove(message.id)}
                                  aria-label={t('Sil', 'Delete')}
                                  title={t('Sil', 'Delete')}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {peerTyping ? (
                      <div className="dm-bubble-row is-theirs">
                        <p className="dm-bubble dm-typing">
                          <span />
                          <span />
                          <span />
                        </p>
                      </div>
                    ) : null}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>

              {draftAttachment ? (
                <div className="dm-draft">
                  {renderAttachment(draftAttachment)}
                  <button
                    type="button"
                    className="icon-button subtle"
                    onClick={() => setDraftAttachment(null)}
                    aria-label={t('Paylaşımı kaldır', 'Remove attachment')}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}

              <div className="dm-share" hidden={!shareOpen}>
                {nowPlaying ? (
                  <button
                    type="button"
                    className="dm-share-item"
                    onClick={() => {
                      setDraftAttachment(trackAttachment(nowPlaying));
                      setShareOpen(false);
                    }}
                  >
                    <Music2 size={14} /> {t('Şu an çalan şarkı', 'Now playing')}
                    <small>{nowPlaying.title}</small>
                  </button>
                ) : (
                  <p className="dm-share-hint">{t('Şu an çalan bir şarkı yok.', 'Nothing is playing right now.')}</p>
                )}
                {playlists?.map((playlist) => (
                  <button
                    type="button"
                    key={playlist.id}
                    className="dm-share-item"
                    onClick={() => {
                      setDraftAttachment({
                        kind: 'playlist',
                        title: playlist.name.slice(0, 200),
                        subtitle: `${playlist.trackCount} ${t('parça', 'tracks')}`,
                        coverUrl: playlist.coverUrl,
                        playlistId: playlist.id,
                      });
                      setShareOpen(false);
                    }}
                  >
                    <ListMusic size={14} /> {playlist.name}
                    <small>{playlist.trackCount} {t('parça', 'tracks')}</small>
                  </button>
                ))}
                {myId ? (
                  <button
                    type="button"
                    className="dm-share-item"
                    onClick={() => {
                      setDraftAttachment({ kind: 'profile', title: t('Profilim', 'My profile'), subtitle: null, coverUrl: null, userId: myId });
                      setShareOpen(false);
                    }}
                  >
                    <UserRound size={14} /> {t('Profilimi paylaş', 'Share my profile')}
                  </button>
                ) : null}
              </div>

              <div className="dm-composer">
                <button
                  type="button"
                  className={`icon-button subtle dm-attach-btn ${shareOpen ? 'is-open' : ''}`}
                  onClick={() => void toggleShare()}
                  disabled={!canSend}
                  aria-label={t('Müzik paylaş', 'Share music')}
                  title={t('Müzik paylaş', 'Share music')}
                >
                  <Share2 size={17} />
                </button>
                <textarea
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value.slice(0, MAX_BODY));
                    notifyTyping();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  maxLength={MAX_BODY}
                  placeholder={
                    canSend
                      ? t('Bir mesaj yaz…', 'Write a message…')
                      : t('Artık bu kişiye mesaj gönderemezsin.', 'You can no longer message this person.')
                  }
                  disabled={!canSend}
                  aria-label={t('Mesaj', 'Message')}
                />
                <button
                  type="button"
                  className="button dm-send"
                  onClick={() => void send()}
                  disabled={!canSend || sending || (!text.trim() && !draftAttachment)}
                  aria-label={t('Gönder', 'Send')}
                >
                  {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {pickerOpen ? (
        <div className="dm-picker" role="dialog" aria-modal="true" aria-label={t('Yeni sohbet', 'New chat')}>
          <div className="dm-picker-card">
            <header>
              <h4>{t('Kime yazmak istersin?', 'Who do you want to message?')}</h4>
              <button
                type="button"
                className="icon-button subtle"
                onClick={() => setPickerOpen(false)}
                aria-label={t('Kapat', 'Close')}
              >
                <X size={16} />
              </button>
            </header>
            {friends.length === 0 ? (
              <p className="dm-share-hint">
                {t('Mesajlaşmak için önce arkadaş olmalısın.', 'You need a friendship before you can message.')}
              </p>
            ) : (
              <div className="dm-picker-list">
                {friends.map((friend) => (
                  <button
                    type="button"
                    key={friend.id}
                    className="person-row dm-picker-row"
                    onClick={() => void startWith(friend.id)}
                  >
                    <Cover src={friend.avatarUrl} alt="" seed={friend.id} className="person-avatar" iconSize={16} />
                    <span className="person-copy">
                      <strong>{friend.displayName}</strong>
                      <small>{friend.username ? `@${friend.username}` : ''}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
