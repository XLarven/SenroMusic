import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, HeartHandshake, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import { TasteScore } from '../taste/tasteUi';

/**
 * Compact Taste Match teaser for the Community grid: your best matches plus a
 * way into the full page. Nothing is invented — friends without data show "—".
 */
export function TasteMatchPanel() {
  const overview = useQuery({ queryKey: ['taste', 'me'], queryFn: () => api.tasteMe(), staleTime: 60_000 });
  const friends = useQuery({ queryKey: ['taste', 'friends'], queryFn: () => api.tasteFriends(8, 0), staleTime: 60_000 });

  if (overview.isPending || friends.isPending) {
    return (
      <div className="taste-loading">
        <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
      </div>
    );
  }

  const eligible = overview.data?.profile.eligible ?? false;
  const items = (friends.data?.items ?? []).filter((entry) => entry.user);

  if (!eligible) {
    return (
      <div className="taste-teaser">
        <HeartHandshake size={18} />
        <p>
          {t(
            'Zevk uyumu için biraz dinleme geçmişi gerekiyor. Birkaç şarkı dinledikten sonra arkadaşlarınla uyumunu gör.',
            'Taste match needs a little listening history first. Play a few songs, then compare with your friends.',
          )}
        </p>
        <Link className="button ghost compact" to="/community/taste">
          {t('Zevk Uyumu', 'Taste Match')} <ArrowUpRight size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div className="taste-mini">
      <ul className="taste-mini-list">
        {items.slice(0, 3).map((entry) =>
          entry.user ? (
            <li key={entry.user.id}>
              <TasteScore score={entry.score} size="sm" />
              <Cover src={entry.user.avatarUrl} alt="" seed={entry.user.id} className="taste-avatar is-mini" iconSize={14} />
              <Link className="taste-name" to={`/community/taste/${entry.user.id}`}>
                {entry.user.displayName}
                <small>
                  {entry.score === null
                    ? t('Yeterli veri yok', 'Not enough data')
                    : t(`${entry.sharedArtists} ortak sanatçı`, `${entry.sharedArtists} shared artists`)}
                </small>
              </Link>
            </li>
          ) : null,
        )}
        {items.length === 0 ? <li className="taste-name">{t('Henüz arkadaş yok.', 'No friends yet.')}</li> : null}
      </ul>
      <Link className="taste-more" to="/community/taste">
        {t('Tüm uyumları gör', 'See all matches')} <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}
