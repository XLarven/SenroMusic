import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  Loader2,
  Pencil,
  Play,
  Send,
  Share2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import { subscribeRealtime } from '../../lib/presence';
import { shareToTrack } from '../../lib/presenceTrack';
import { useAuthStore } from '../../store/auth';
import { usePlayer } from '../../store/player';
import { useToastStore } from '../../store/toast';
import type { CommunityMe, CommunityMessage, CommunityRole, MessageAttachment, PlaylistSummary } from '../../types';

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : `${date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
}

/**
 * Global community chat.
 *
 * One feed for every registered account: messages are persisted before they are
 * broadcast, deduplicated by id, and the SSE stream is the same one used by
 * presence, DMs, rooms and quiz.
 */
export function CommunityChat({ me }: { me: CommunityMe | null }) {
  const myId = useAuthStore((state) => state.user?.id ?? null);
  const pushToast = useToastStore((state) => state.push);
  const playTrack = usePlayer((state) => state.playTrack);
  const nowPlaying = usePlayer((state) => state.current);

  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<MessageAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const role: CommunityRole = me?.role ?? 'member';
  const canModerate = role === 'owner' || role === 'moderator';
  const canPost = me?.restrictions.canPost ?? true;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .communityMessages()
      .then((page) => {
        if (cancelled) return;
        setMessages(page.items);
        setHasMore(page.hasMore);
        setLoading(false);
        window.requestAnimationFrame(() => scrollToBottom('auto'));
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          pushToast(t('Topluluk akışı yüklenemedi.', 'The community feed could not be loaded.'), 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast, scrollToBottom]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'community_message') {
        setMessages((previous) =>
          previous.some((message) => message.id === event.message.id) ? previous : [...previous, event.message],
        );
        if (atBottom) {
          window.requestAnimationFrame(() => scrollToBottom());
        }
        return;
      }
      if (event.type === 'community_message_update') {
        setMessages((previous) =>
          previous.map((message) => (message.id === event.message.id ? event.message : message)),
        );
      }
    });
    return unsubscribe;
  }, [atBottom, scrollToBottom]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const onScroll = () => {
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
      setAtBottom(nearBottom);
    };
    node.addEventListener('scroll', onScroll);
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const node = listRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    try {
      const page = await api.communityMessages(messages[0]?.createdAt ?? null, 40);
      setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id));
        return [...page.items.filter((message) => !seen.has(message.id)), ...previous];
      });
      setHasMore(page.hasMore);
      window.requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - previousHeight;
      });
    } catch {
      pushToast(t('Eski mesajlar yüklenemedi.', 'Older messages could not be loaded.'), 'error');
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messages, pushToast]);

  const send = useCallback(async () => {
    const body = text.trim();
    if ((!body && !draft) || sending || !canPost) return;
    setSending(true);
    try {
      const result = await api.communitySend({
        body,
        clientId: crypto.randomUUID(),
        attachment: draft,
      });
      setMessages((previous) =>
        previous.some((message) => message.id === result.message.id) ? previous : [...previous, result.message],
      );
      setText('');
      setDraft(null);
      setAtBottom(true);
      window.requestAnimationFrame(() => scrollToBottom());
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Mesaj gönderilemedi.', 'Message failed.'), 'error');
    } finally {
      setSending(false);
    }
  }, [canPost, draft, pushToast, scrollToBottom, sending, text]);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    try {
      const result = await api.communityEdit(editing.id, body);
      setMessages((previous) => previous.map((message) => (message.id === result.message.id ? result.message : message)));
      setEditing(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Mesaj düzenlenemedi.', 'Edit failed.'), 'error');
    }
  }, [editing, pushToast]);

  const remove = useCallback(
    async (messageId: string) => {
      try {
        const result = await api.communityDelete(messageId);
        setMessages((previous) => previous.map((message) => (message.id === result.message.id ? result.message : message)));
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Mesaj silinemedi.', 'Delete failed.'), 'error');
      }
    },
    [pushToast],
  );

  const report = useCallback(
    async (messageId: string, reason: string) => {
      try {
        await api.communityReport(messageId, reason);
        pushToast(t('Bildirim moderatörlere iletildi.', 'Report sent to the moderators.'), 'success');
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Bildirim gönderilemedi.', 'Report failed.'), 'error');
      } finally {
        setReporting(null);
      }
    },
    [pushToast],
  );

  const toggleShare = useCallback(async () => {
    const next = !shareOpen;
    setShareOpen(next);
    if (next && playlists === null) {
      try {
        const payload = await api.playlists();
        setPlaylists(payload.playlists.filter((item) => item.visibility === 'public' || item.isOwner).slice(0, 8));
      } catch {
        setPlaylists([]);
      }
    }
  }, [playlists, shareOpen]);

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
    <div className="community-chat">
      <div className="community-chat-head">
        <div>
          <h2>{t('Genel Sohbet', 'General Chat')}</h2>
          <p>{t('Herkese açık topluluk akışı', 'The public community feed')}</p>
        </div>
        {hasMore ? (
          <button type="button" className="button ghost compact" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? <Loader2 size={13} className="spin" /> : <ArrowDown size={13} className="flip-y" />}
            {t('Eski mesajlar', 'Older')}
          </button>
        ) : null}
      </div>

      <div className="community-feed" ref={listRef}>
        {loading ? (
          <div className="dm-list-status">
            <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
          </div>
        ) : messages.length === 0 ? (
          <div className="dm-list-status">
            <p>{t('Henüz mesaj yok. İlkini sen yaz.', 'No messages yet. Say hello.')}</p>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.userId === myId;
            if (message.deletedAt) {
              return (
                <p key={message.id} className="community-deleted">
                  {t('Bu mesaj silindi', 'This message was deleted')}
                </p>
              );
            }
            return (
              <article key={message.id} className={`community-message ${mine ? 'is-mine' : ''}`}>
                <Link to={message.author?.username ? `/u/${message.author.username}` : `/profile/${message.userId}`}>
                  <Cover
                    src={message.author?.avatarUrl ?? null}
                    alt=""
                    seed={message.userId}
                    className="community-avatar"
                    iconSize={14}
                  />
                </Link>
                <div className="community-message-body">
                  <header>
                    <Link
                      className="community-author"
                      to={message.author?.username ? `/u/${message.author.username}` : `/profile/${message.userId}`}
                    >
                      {message.author?.displayName ?? t('Üye', 'Member')}
                    </Link>
                    {message.author?.username ? <span className="community-handle">@{message.author.username}</span> : null}
                    {message.author?.role === 'owner' ? <span className="community-role is-owner">{t('Kurucu', 'Owner')}</span> : null}
                    {message.author?.role === 'moderator' ? (
                      <span className="community-role">{t('Moderatör', 'Moderator')}</span>
                    ) : null}
                    <time>{clock(message.createdAt)}</time>
                    {message.editedAt ? <small>{t('düzenlendi', 'edited')}</small> : null}
                  </header>

                  {editing?.id === message.id ? (
                    <div className="dm-edit">
                      <textarea
                        value={editing.body}
                        onChange={(event) => setEditing({ id: message.id, body: event.target.value })}
                        rows={2}
                        maxLength={2000}
                      />
                      <div className="dm-edit-actions">
                        <button type="button" className="button compact" onClick={() => void saveEdit()}>
                          {t('Kaydet', 'Save')}
                        </button>
                        <button type="button" className="button ghost compact" onClick={() => setEditing(null)}>
                          {t('Vazgeç', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {message.attachment ? renderAttachment(message.attachment) : null}
                      {message.body ? <p className="community-text">{message.body}</p> : null}
                    </>
                  )}

                  {editing?.id !== message.id ? (
                    <div className="community-message-actions">
                      {mine && message.body ? (
                        <button type="button" className="icon-button subtle" onClick={() => setEditing({ id: message.id, body: message.body })} aria-label={t('Düzenle', 'Edit')}>
                          <Pencil size={12} />
                        </button>
                      ) : null}
                      {mine || canModerate ? (
                        <button type="button" className="icon-button subtle" onClick={() => void remove(message.id)} aria-label={t('Sil', 'Delete')}>
                          <Trash2 size={12} />
                        </button>
                      ) : null}
                      {!mine ? (
                        <button type="button" className="icon-button subtle" onClick={() => setReporting(message.id)} aria-label={t('Bildir', 'Report')}>
                          <ShieldAlert size={12} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {reporting ? (
        <div className="community-report-bar">
          <span>{t('Bildirim sebebi:', 'Report reason:')}</span>
          {[
            ['spam', t('Spam', 'Spam')],
            ['harassment', t('Taciz', 'Harassment')],
            ['hate', t('Nefret', 'Hate')],
            ['other', t('Diğer', 'Other')],
          ].map(([key, label]) => (
            <button key={key} type="button" className="button ghost compact" onClick={() => void report(reporting, key)}>
              {label}
            </button>
          ))}
          <button type="button" className="icon-button subtle" onClick={() => setReporting(null)} aria-label={t('İptal', 'Cancel')}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      {!canPost ? (
        <p className="community-notice">
          {me?.restrictions.reason === 'suspended'
            ? t('Topluluktan geçici olarak uzaklaştırıldın.', 'You are temporarily suspended from the community.')
            : t('Susturulmuşsun; şu an mesaj gönderemezsin.', 'You are muted and cannot send messages right now.')}
        </p>
      ) : null}

      {draft ? (
        <div className="dm-draft">
          {renderAttachment(draft)}
          <button type="button" className="icon-button subtle" onClick={() => setDraft(null)} aria-label={t('Kaldır', 'Remove')}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      {shareOpen ? (
        <div className="dm-share">
          {nowPlaying ? (
            <button
              type="button"
              className="dm-share-item"
              onClick={() => {
                const trackId = /^(yt_[\w-]{11}|sp_[\w-]{1,80}|t_[a-f0-9]{8,32}|presence_[\w-]{1,60})$/.test(nowPlaying.id)
                  ? nowPlaying.id
                  : `presence_${`${nowPlaying.title}-${nowPlaying.artist}`.replace(/[^\w-]+/g, '-')}`.slice(0, 60);
                setDraft({
                  kind: 'track',
                  title: nowPlaying.title,
                  subtitle: nowPlaying.artist,
                  coverUrl: nowPlaying.coverUrl,
                  trackId,
                  source: nowPlaying.format ?? null,
                });
                setShareOpen(false);
              }}
            >
              <Share2 size={14} /> {t('Şu an çalan', 'Now playing')}
              <small>{nowPlaying.title}</small>
            </button>
          ) : (
            <p className="dm-share-hint">{t('Şu an çalan bir şarkı yok.', 'Nothing is playing.')}</p>
          )}
          {playlists?.map((playlist) => (
            <button
              type="button"
              key={playlist.id}
              className="dm-share-item"
              onClick={() => {
                setDraft({
                  kind: 'playlist',
                  title: playlist.name,
                  subtitle: `${playlist.trackCount} ${t('parça', 'tracks')}`,
                  coverUrl: playlist.coverUrl,
                  playlistId: playlist.id,
                });
                setShareOpen(false);
              }}
            >
              {playlist.name}
              <small>{playlist.trackCount} {t('parça', 'tracks')}</small>
            </button>
          ))}
          {myId ? (
            <button
              type="button"
              className="dm-share-item"
              onClick={() => {
                setDraft({ kind: 'profile', title: t('Profilim', 'My profile'), subtitle: null, coverUrl: null, userId: myId });
                setShareOpen(false);
              }}
            >
              {t('Profilimi paylaş', 'Share my profile')}
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="community-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          className="icon-button subtle"
          onClick={() => void toggleShare()}
          disabled={!canPost}
          aria-label={t('Müzik paylaş', 'Share music')}
          title={t('Müzik paylaş', 'Share music')}
        >
          <Share2 size={16} />
        </button>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, me?.settings.maxMessageLength ?? 2000))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={canPost ? t('Topluluğa yaz…', 'Message the community…') : t('Mesaj gönderemezsin.', 'You cannot send messages.')}
          aria-label={t('Mesaj', 'Message')}
          disabled={!canPost}
        />
        <button type="submit" className="button" disabled={!canPost || sending || (!text.trim() && !draft)}>
          {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          {t('Gönder', 'Send')}
        </button>
      </form>
    </div>
  );
}
