import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, MessageSquare, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { useMusicData } from '../MusicDataContext';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useToastStore } from '../store/toast';

export function NotificationsPage() {
  const { library } = useMusicData();
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications(30, 0),
    staleTime: 15_000,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: () => api.markNotificationsRead(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      pushToast(t('Bildirimler okundu olarak işaretlendi.', 'Notifications marked as read.'), 'success');
    },
  });

  const items = notificationsQuery.data?.items ?? [];
  const unread = notificationsQuery.data?.unread ?? 0;
  const recentTracks = [...library.tracks]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, 6);

  return (
    <div className="page">
      <header className="page-heading">
        <span className="eyebrow">{t('Bildirimler', 'Notifications')}</span>
        <h1>{t('Bildirimler', 'Notifications')}</h1>
        <p>
          {t(
            'Arkadaşlık istekleri, kabul edilen istekler ve kütüphanene eklenenler.',
            'Friend requests, accepted requests and new library additions.',
          )}
        </p>
      </header>

      <section className="content-section" aria-label={t('Etkinlik', 'Activity')}>
        <div className="section-heading">
          <div>
            <h2>{t('Topluluk', 'Community')}</h2>
            <p>
              {unread > 0
                ? t(`${unread} okunmamış bildirim`, `${unread} unread`)
                : t('Tümü okundu', 'All read')}
            </p>
          </div>
          {unread > 0 ? (
            <button
              type="button"
              className="button ghost compact"
              onClick={() => markRead.mutate()}
              disabled={markRead.isPending}
            >
              <Check size={15} />
              {t('Okundu işaretle', 'Mark as read')}
            </button>
          ) : null}
        </div>

        {notificationsQuery.isPending ? (
          <p className="settings-hint">{t('Yükleniyor…', 'Loading…')}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t('Henüz bildirim yok.', 'No notifications yet.')}
            description={t(
              'Biri sana arkadaşlık isteği gönderdiğinde burada görünür.',
              'Friend requests and accepted requests show up here.',
            )}
            compact
          />
        ) : (
          <div className="surface-panel notification-list">
            {items.map((entry) => {
              const isRequest = entry.kind === 'friend_request';
              const isMessage = entry.kind === 'message';
              const href = isMessage
                ? '/community'
                : entry.actor?.username
                  ? `/u/${entry.actor.username}`
                  : entry.actor
                    ? `/profile/${entry.actor.id}`
                    : '/community';
              return (
                <article className={`notification-row ${entry.readAt ? 'is-read' : ''}`} key={entry.id}>
                  <span className="notification-icon">
                    {isRequest ? <UserPlus size={17} /> : isMessage ? <MessageSquare size={17} /> : <Users size={17} />}
                  </span>
                  {entry.actor ? (
                    <Cover
                      src={entry.actor.avatarUrl}
                      alt=""
                      seed={entry.actor.id}
                      className="notification-avatar"
                      iconSize={14}
                    />
                  ) : null}
                  <Link to={href} className="notification-copy">
                    <strong>
                      {entry.actor?.displayName ?? t('Bir kullanıcı', 'A user')}
                      {' · '}
                      {isRequest
                        ? t('sana arkadaşlık isteği gönderdi', 'sent you a friend request')
                        : isMessage
                          ? t('sana bir mesaj gönderdi', 'sent you a message')
                          : t('arkadaşlık isteğini kabul etti', 'accepted your friend request')}
                    </strong>
                    <small>{formatDate(entry.createdAt)}</small>
                  </Link>
                  <Link to={isMessage ? '/community' : '/community'} className="button ghost compact">
                    {isRequest
                      ? t('İsteklere git', 'Open requests')
                      : isMessage
                        ? t('Mesajlara git', 'Open messages')
                        : t('Profile git', 'Open profile')}
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="content-section" aria-label={t('Kütüphane', 'Library')}>
        <div className="section-heading">
          <div>
            <h2>{t('Kütüphaneye eklenenler', 'Added to your library')}</h2>
            <p>{t('Son eklenen parçalar.', 'Most recent tracks.')}</p>
          </div>
        </div>
        {recentTracks.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t('Kütüphane boş.', 'Library is empty.')}
            description={t('Yeni şarkılar eklenince burada görünür.', 'New tracks appear here.')}
            compact
          />
        ) : (
          <div className="surface-panel">
            {recentTracks.map((track) => (
              <div key={track.id} className="notification-row">
                <Cover src={track.coverUrl} alt="" seed={track.id} className="notification-avatar" iconSize={14} />
                <div className="notification-copy">
                  <strong>{track.title}</strong>
                  <small>
                    {track.artist} · {formatDate(track.addedAt)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
