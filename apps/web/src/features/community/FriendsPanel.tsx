import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Inbox, Loader2, Search, Send, UsersRound, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { EmptyState } from '../../components/EmptyState';
import { t } from '../../lib/i18n';
import { useToastStore } from '../../store/toast';
import type { FriendCounts, FriendRequestEntry, FriendUser } from '../../types';

type Tab = 'friends' | 'incoming' | 'outgoing';

const PAGE = 20;

/**
 * Friends surface: accepted friends with a filter box, plus incoming and
 * outgoing request lists. Every row carries the action that matches its state.
 */
export function FriendsPanel() {
  const pushToast = useToastStore((state) => state.push);
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestEntry[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestEntry[]>([]);
  const [counts, setCounts] = useState<FriendCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [hasMore, setHasMore] = useState<{ friends: boolean; incoming: boolean; outgoing: boolean }>({
    friends: false,
    incoming: false,
    outgoing: false,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [friendsRes, incomingRes, outgoingRes] = await Promise.all([
        api.friends(PAGE, 0),
        api.friendRequests('in', PAGE, 0),
        api.friendRequests('out', PAGE, 0),
      ]);
      setFriends(friendsRes.friends.items);
      setIncoming(incomingRes.requests.items);
      setOutgoing(outgoingRes.requests.items);
      setCounts(friendsRes.counts);
      setHasMore({
        friends: friendsRes.friends.items.length < friendsRes.friends.total,
        incoming: incomingRes.requests.items.length < incomingRes.requests.total,
        outgoing: outgoingRes.requests.items.length < outgoingRes.requests.total,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Arkadaşlar yüklenemedi.', 'Could not load friends.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<void>, message: string) => {
    if (busyId) return;
    setBusyId(key);
    try {
      await action();
      pushToast(message, 'success');
      await load();
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : t('İşlem başarısız.', 'Action failed.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const loadMore = async (which: Tab) => {
    setLoadingMore(true);
    try {
      if (which === 'friends') {
        const res = await api.friends(PAGE, friends.length);
        setFriends((prev) => [...prev, ...res.friends.items]);
        setHasMore((prev) => ({ ...prev, friends: prev.friends && res.friends.items.length > 0 }));
        setCounts(res.counts);
      } else {
        const res = await api.friendRequests(which === 'incoming' ? 'in' : 'out', PAGE, which === 'incoming' ? incoming.length : outgoing.length);
        if (which === 'incoming') setIncoming((prev) => [...prev, ...res.requests.items]);
        else setOutgoing((prev) => [...prev, ...res.requests.items]);
        setHasMore((prev) => ({ ...prev, [which]: prev[which] && res.requests.items.length > 0 }));
        setCounts(res.counts);
      }
    } catch {
      pushToast(t('Daha fazlası yüklenemedi.', 'Could not load more.'), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleFriends = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase('tr');
    if (!needle) return friends;
    return friends.filter((friend) => {
      const haystack = `${friend.displayName} ${friend.username ?? ''}`.toLocaleLowerCase('tr');
      return haystack.includes(needle);
    });
  }, [friends, filter]);

  if (loading) {
    return (
      <div className="friends-loading">
        <Loader2 size={18} className="spin" /> {t('Arkadaşlar yükleniyor…', 'Loading friends…')}
      </div>
    );
  }

  return (
    <div className="friends-panel">
      <div className="friends-tabs" role="tablist" aria-label={t('Arkadaşlar', 'Friends')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'friends'}
          className={clsx('library-tab', tab === 'friends' && 'is-active')}
          onClick={() => setTab('friends')}
        >
          <UsersRound size={15} />
          {t('Arkadaşlarım', 'My friends')}
          <span>{counts?.friends ?? friends.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'incoming'}
          className={clsx('library-tab', tab === 'incoming' && 'is-active')}
          onClick={() => setTab('incoming')}
        >
          <Inbox size={15} />
          {t('Gelen istekler', 'Incoming')}
          <span>{counts?.incoming ?? incoming.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'outgoing'}
          className={clsx('library-tab', tab === 'outgoing' && 'is-active')}
          onClick={() => setTab('outgoing')}
        >
          <Send size={15} />
          {t('Gönderilen', 'Sent')}
          <span>{counts?.outgoing ?? outgoing.length}</span>
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {tab === 'friends' ? (
        <>
          <div className="friends-filter">
            <Search size={16} aria-hidden="true" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('Arkadaşlarda ara…', 'Search friends…')}
              aria-label={t('Arkadaşlarda ara', 'Search friends')}
              type="search"
            />
          </div>

          {visibleFriends.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={filter ? t('Eşleşen arkadaş yok.', 'No matching friends.') : t('Henüz arkadaşın yok.', 'No friends yet.')}
              description={
                filter
                  ? t('Farklı bir isim dene.', 'Try a different name.')
                  : t(
                      'Profil sayfalarından veya Kişiler aramasından arkadaş ekleyebilirsin.',
                      'Add people from their profile or from the people search above.',
                    )
              }
              compact
            />
          ) : (
            <div className="surface-panel people-list">
              {visibleFriends.map((friend) => (
                <div className="person-row" key={friend.id}>
                  <Cover src={friend.avatarUrl} alt="" seed={friend.id} className="person-avatar" iconSize={16} />
                  <Link className="person-copy" to={friend.username ? `/u/${friend.username}` : `/profile/${friend.id}`}>
                    <strong>{friend.displayName}</strong>
                    <small>{friend.username ? `@${friend.username}` : t('Profil', 'Profile')}</small>
                  </Link>
                  <button
                    type="button"
                    className="icon-button subtle friend-remove"
                    disabled={busyId === friend.id}
                    onClick={() =>
                      void run(
                        friend.id,
                        async () => {
                          await api.removeFriend(friend.id);
                        },
                        t('Arkadaşlıktan çıkarıldı.', 'Friend removed.'),
                      )
                    }
                    aria-label={t('Arkadaşlıktan çıkar', 'Remove friend')}
                    title={t('Arkadaşlıktan çıkar', 'Remove friend')}
                  >
                    {busyId === friend.id ? <Loader2 size={16} className="spin" /> : <X size={16} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {hasMore.friends ? (
            <button type="button" className="button ghost compact friends-more" onClick={() => void loadMore('friends')} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="spin" /> : null}
              {t('Daha fazla göster', 'Show more')}
            </button>
          ) : null}
        </>
      ) : null}

      {tab === 'incoming' ? (
        incoming.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t('Gelen istek yok.', 'No incoming requests.')}
            description={t('Biri sana istek gönderdiğinde burada görünür.', 'Requests appear here when someone adds you.')}
            compact
          />
        ) : (
          <div className="surface-panel people-list">
            {incoming.map((entry) => (
              <div className="person-row" key={entry.friendshipId}>
                <Cover src={entry.user.avatarUrl} alt="" seed={entry.user.id} className="person-avatar" iconSize={16} />
                <Link
                  className="person-copy"
                  to={entry.user.username ? `/u/${entry.user.username}` : `/profile/${entry.user.id}`}
                >
                  <strong>{entry.user.displayName}</strong>
                  <small>{entry.user.username ? `@${entry.user.username}` : t('Profil', 'Profile')}</small>
                </Link>
                <div className="friend-row-actions">
                  <button
                    type="button"
                    className="button primary compact"
                    disabled={busyId === `a-${entry.friendshipId}`}
                    onClick={() =>
                      void run(
                        `a-${entry.friendshipId}`,
                        async () => {
                          await api.acceptFriendRequest(entry.friendshipId);
                        },
                        t('İstek kabul edildi.', 'Request accepted.'),
                      )
                    }
                  >
                    {busyId === `a-${entry.friendshipId}` ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                    {t('Kabul et', 'Accept')}
                  </button>
                  <button
                    type="button"
                    className="button ghost compact"
                    disabled={busyId === `d-${entry.friendshipId}`}
                    onClick={() =>
                      void run(
                        `d-${entry.friendshipId}`,
                        async () => {
                          await api.declineFriendRequest(entry.friendshipId);
                        },
                        t('İstek reddedildi.', 'Request declined.'),
                      )
                    }
                  >
                    {busyId === `d-${entry.friendshipId}` ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                    {t('Reddet', 'Decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'outgoing' ? (
        outgoing.length === 0 ? (
          <EmptyState
            icon={Send}
            title={t('Gönderilen istek yok.', 'No sent requests.')}
            description={t('Birine istek gönderdiğinde burada takip edebilirsin.', 'Track your sent requests here.')}
            compact
          />
        ) : (
          <div className="surface-panel people-list">
            {outgoing.map((entry) => (
              <div className="person-row" key={entry.friendshipId}>
                <Cover src={entry.user.avatarUrl} alt="" seed={entry.user.id} className="person-avatar" iconSize={16} />
                <Link
                  className="person-copy"
                  to={entry.user.username ? `/u/${entry.user.username}` : `/profile/${entry.user.id}`}
                >
                  <strong>{entry.user.displayName}</strong>
                  <small>{entry.user.username ? `@${entry.user.username}` : t('Profil', 'Profile')}</small>
                </Link>
                <div className="friend-row-actions">
                  <span className="status-pill is-warning">{t('İstek gönderildi', 'Request sent')}</span>
                  <button
                    type="button"
                    className="button ghost compact"
                    disabled={busyId === `c-${entry.friendshipId}`}
                    onClick={() =>
                      void run(
                        `c-${entry.friendshipId}`,
                        async () => {
                          await api.cancelFriendRequest(entry.friendshipId);
                        },
                        t('İstek geri çekildi.', 'Request cancelled.'),
                      )
                    }
                  >
                    {busyId === `c-${entry.friendshipId}` ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                    {t('Geri çek', 'Cancel')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'incoming' && hasMore.incoming ? (
        <button type="button" className="button ghost compact friends-more" onClick={() => void loadMore('incoming')} disabled={loadingMore}>
          {t('Daha fazla göster', 'Show more')}
        </button>
      ) : null}
      {tab === 'outgoing' && hasMore.outgoing ? (
        <button type="button" className="button ghost compact friends-more" onClick={() => void loadMore('outgoing')} disabled={loadingMore}>
          {t('Daha fazla göster', 'Show more')}
        </button>
      ) : null}

      <p className="friends-hint">
        <ArrowUpRight size={13} />{' '}
        {t(
          'Profillerdeki düğmeyle de istek gönderebilirsin.',
          'You can also send requests from a profile page.',
        )}
      </p>
    </div>
  );
}
