import { useEffect, useState } from 'react';
import { Clock3, Headphones } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { formatDate } from '../../lib/format';
import { t } from '../../lib/i18n';
import { activityToTrack } from '../../lib/presenceTrack';
import { usePlayer } from '../../store/player';
import type { FriendPresence } from '../../types';

/**
 * Presence strip for a public profile. The server decides what is visible: a
 * hidden or blocked user arrives as "offline" with no fields, and the component
 * then shows only the generic "offline" line.
 */
export function ProfilePresence({ userId }: { userId: string }) {
  const [presence, setPresence] = useState<FriendPresence | null>(null);
  const [denied, setDenied] = useState(false);
  const playTrack = usePlayer((state) => state.playTrack);

  useEffect(() => {
    let cancelled = false;
    void api
      .presenceUser(userId)
      .then((payload) => {
        if (!cancelled) setPresence(payload.presence);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (denied || !presence) return null;

  const online = presence.status === 'online';
  const away = presence.status === 'away';
  const activity = presence.activity;

  return (
    <section className="profile-presence" aria-label={t('Durum', 'Status')}>
      <span className={`presence-dot is-${presence.status}`}>
        <span />
        {online ? t('Çevrimiçi', 'Online') : away ? t('Uzakta', 'Away') : t('Çevrimdışı', 'Offline')}
      </span>
      {presence.lastSeenAt && !online ? (
        <span className="profile-last-seen">
          <Clock3 size={13} /> {t('Son görülme', 'Last seen')} {formatDate(presence.lastSeenAt)}
        </span>
      ) : null}

      {activity ? (
        <div className="profile-now-playing">
          <Cover src={activity.coverUrl} alt="" seed={activity.title} className="profile-now-cover" iconSize={16} />
          <div className="profile-now-copy">
            <small>
              <Headphones size={12} /> {activity.playing ? t('şu an dinliyor', 'listening now') : t('duraklattı', 'paused')}
            </small>
            <strong>{activity.title}</strong>
            <span>{activity.artist}</span>
          </div>
          <button
            type="button"
            className="play-button play-button-sm"
            onClick={() => playTrack(activityToTrack(activity))}
            aria-label={t('Şarkıyı aç', 'Open track')}
          >
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
