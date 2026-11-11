import { Link } from 'react-router-dom';
import { Headphones, Play } from 'lucide-react';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import { activityToTrack } from '../../lib/presenceTrack';
import { usePlayer } from '../../store/player';
import { useFriendsPresence } from './useFriendsPresence';

/**
 * "Friends listening now": only real playback events from real friends. With no
 * listeners the section renders nothing at all.
 */
export function ListeningNow() {
  const presence = useFriendsPresence();
  const playTrack = usePlayer((state) => state.playTrack);
  const listeners = presence.listeners;

  if (listeners.length === 0) return null;

  return (
    <section className="content-section listening-now" aria-label={t('Şu an dinleyenler', 'Listening now')}>
      <div className="section-heading">
        <div>
          <h2>
            <Headphones size={18} /> {t('Arkadaşların şu an dinliyor', 'Friends listening now')}
          </h2>
          <p>
            {listeners.length} {t('arkadaşın müzik dinliyor', 'friends are listening')}
          </p>
        </div>
        <span className="status-pill">{presence.onlineCount} {t('çevrimiçi', 'online')}</span>
      </div>

      <div className="listening-grid">
        {listeners.map((entry) => {
          const activity = entry.activity;
          if (!activity) return null;
          const track = activityToTrack(activity);
          return (
            <article className="listening-card" key={entry.userId}>
              <Cover src={activity.coverUrl} alt="" seed={activity.title} className="listening-cover" iconSize={22} />
              <div className="listening-copy">
                <strong>{activity.title}</strong>
                <small>{activity.artist}</small>
                <span className={`presence-dot is-${entry.status}`}>
                  <span />
                  {entry.status === 'online' ? t('çalıyor', 'playing') : t('uzakta', 'away')}
                </span>
              </div>
              <button
                type="button"
                className="play-button play-button-sm"
                onClick={() => playTrack(track)}
                aria-label={`${activity.title} ${t('çal', 'play')}`}
                title={t('Şarkıyı aç', 'Open track')}
              >
                <Play size={14} fill="currentColor" />
              </button>
            </article>
          );
        })}
      </div>

      <p className="listening-hint">
        <Link to="/community">{t('Arkadaşlarını gör', 'See your friends')}</Link>
      </p>
    </section>
  );
}
