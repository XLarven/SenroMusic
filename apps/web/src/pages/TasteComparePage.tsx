import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, LockKeyhole, Loader2, Music2, ShieldQuestion } from 'lucide-react';
import { api, ApiError } from '../api';
import { Cover } from '../components/Cover';
import { t } from '../lib/i18n';
import { TasteDimensionBars, TasteExplanation, TasteScore } from '../features/taste/tasteUi';
import type { TasteIdentity } from '../types';

function PersonCard({ person, role }: { person: TasteIdentity | null; role: string }) {
  if (!person) return null;
  const href = person.username ? `/u/${person.username}` : `/profile/${person.id}`;
  return (
    <Link className="taste-person" to={href}>
      <Cover src={person.avatarUrl} alt="" seed={person.id} className="taste-person-avatar" iconSize={22} />
      <div>
        <small>{role}</small>
        <strong>{person.displayName}</strong>
        {person.username ? <span>@{person.username}</span> : null}
      </div>
    </Link>
  );
}

/**
 * Two-profile taste comparison.
 *
 * The server already applied privacy and blocks; this page never decides who may
 * see what — it only explains the number it was given.
 */
export function TasteComparePage() {
  const { userId = '' } = useParams();
  const query = useQuery({
    queryKey: ['taste', 'compare', userId],
    queryFn: () => api.tasteCompare(userId),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isPending) {
    return (
      <div className="page taste-page">
        <div className="taste-loading">
          <Loader2 size={18} className="spin" /> {t('Karşılaştırma hazırlanıyor', 'Building the comparison')}
        </div>
      </div>
    );
  }

  const error = query.error;
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="page taste-page">
        <Link className="button ghost compact" to="/community/taste">
          <ArrowLeft size={15} /> {t('Geri', 'Back')}
        </Link>
        <div className="taste-blocked">
          <LockKeyhole size={26} />
          <h2>
            {status === 403
              ? t('Bu karşılaştırma paylaşılmıyor', 'This comparison is not shared')
              : t('Karşılaştırma yapılamadı', 'The comparison could not be built')}
          </h2>
          <p>
            {status === 403
              ? t(
                  'Kullanıcı zevk karşılaştırmasını yalnız arkadaşlarına veya kimseye açmamış. Bu ayar sunucuda uygulanır.',
                  'This listener shares taste comparisons only with friends, or with nobody. The rule is enforced on the server.',
                )
              : t('Bağlantı geçersiz olabilir.', 'The link may be invalid.')}
          </p>
          <Link className="button" to="/community/taste">
            {t('Zevk Uyumu sayfası', 'Taste Match page')}
          </Link>
        </div>
      </div>
    );
  }

  if (!query.data) return null;
  const { viewer, target, relationship, comparison } = query.data;
  const score = comparison.score;

  return (
    <div className="page taste-page">
      <Link className="button ghost compact" to="/community/taste">
        <ArrowLeft size={15} /> {t('Zevk Uyumu', 'Taste Match')}
      </Link>

      <section className="content-section">
        <div className="taste-versus">
          <PersonCard person={viewer} role={t('Sen', 'You')} />
          <TasteScore score={score} size="lg" label={t('uyum', 'match')} />
          <PersonCard person={target} role={relationship === 'self' ? t('Sen', 'You') : t('Karşılaştırılan', 'Compared with')} />
        </div>

        <div className="taste-explain-box">
          <TasteExplanation comparison={comparison} />
          {comparison.sharedHidden ? (
            <p className="taste-thin-note">
              <ShieldQuestion size={13} />{' '}
              {t(
                'Ortak liste gizli; yüzde yine de gerçek veriden hesaplandı.',
                'The shared lists are hidden; the percentage still comes from real data.',
              )}
            </p>
          ) : null}
        </div>
      </section>

      <section className="content-section" aria-label={t('Boyutlar', 'Dimensions')}>
        <div className="section-heading">
          <div>
            <h2>{t('Nasıl hesaplandı?', 'How was it calculated?')}</h2>
            <p>
              {t(
                'Dört boyut, ağırlıklı kosinüs benzerliği. Eksik boyut atılır ve kalanlar yeniden ağırlıklandırılır.',
                'Four dimensions, weighted cosine similarity. A missing dimension is dropped and the rest is re-weighted.',
              )}
            </p>
          </div>
        </div>
        <TasteDimensionBars dimensions={comparison.dimensions} />
      </section>

      {!comparison.sharedHidden ? (
        <>
          <section className="content-section" aria-label={t('Ortak noktalar', 'Shared')}>
            <div className="section-heading">
              <div>
                <h2>{t('Ortak noktalar', 'Shared')}</h2>
                <p>{t('İkinizin de dinlediği sanatçı, parça ve türler.', 'Artists, tracks and genres you both play.')}</p>
              </div>
            </div>

            {comparison.sharedArtists.length === 0 &&
            comparison.sharedTracks.length === 0 &&
            comparison.sharedGenres.length === 0 ? (
              <p className="taste-thin-note">
                {t(
                  'Ortak sanatçı, parça veya tür yok. Yine de aynı sıklıkta dinliyorsanız bu bir yakınlık sayılır.',
                  'No shared artist, track or genre. Listening at a similar rate still counts as closeness.',
                )}
              </p>
            ) : null}

            {comparison.sharedArtists.length > 0 ? (
              <div className="taste-block">
                <h3>{t('Ortak sanatçılar', 'Shared artists')}</h3>
                <div className="taste-chips">
                  {comparison.sharedArtists.map((artist) => (
                    <span className="taste-chip" key={artist.name}>
                      {artist.name} <small>{artist.plays} / {artist.otherPlays}</small>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {comparison.sharedTracks.length > 0 ? (
              <div className="taste-block">
                <h3>{t('Ortak parçalar', 'Shared tracks')}</h3>
                <ul className="taste-track-list">
                  {comparison.sharedTracks.map((track) => (
                    <li key={track.key}>
                      <Cover src={track.coverUrl} alt="" seed={track.title} className="taste-track-cover" iconSize={14} />
                      <span className="taste-name">
                        {track.title}
                        <small>{track.artist}</small>
                      </span>
                      <small>
                        {track.plays} / {track.otherPlays}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {comparison.sharedGenres.length > 0 ? (
              <div className="taste-block">
                <h3>{t('Ortak türler', 'Shared genres')}</h3>
                <div className="taste-chips">
                  {comparison.sharedGenres.map((genre) => (
                    <span className="taste-chip" key={genre.name}>
                      {genre.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {comparison.sharedLanguages.length > 0 ? (
              <div className="taste-block">
                <h3>{t('Ortak diller', 'Shared languages')}</h3>
                <div className="taste-chips">
                  {comparison.sharedLanguages.map((language) => (
                    <span className="taste-chip" key={language.name}>
                      {language.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {comparison.score !== null && comparison.score < 70 ? (
            <section className="content-section" aria-label={t('Farklar', 'Differences')}>
              <div className="section-heading">
                <div>
                  <h2>{t('Farklar', 'Differences')}</h2>
                  <p>{t('Her birinizin diğerinde olmayan tarafı.', 'What each of you has that the other does not.')}</p>
                </div>
              </div>
              <div className="taste-diff">
                <div>
                  <h3>{t('Sende öne çıkan', 'Prominent for you')}</h3>
                  <div className="taste-chips">
                    {comparison.onlyViewer.artists.map((artist) => (
                      <span className="taste-chip" key={artist.name}>
                        {artist.name}
                      </span>
                    ))}
                    {comparison.onlyViewer.genres.map((genre) => (
                      <span className="taste-chip is-muted" key={`g-${genre.name}`}>
                        <Music2 size={11} /> {genre.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>{t('Onda öne çıkan', 'Prominent for them')}</h3>
                  <div className="taste-chips">
                    {comparison.onlyTarget.artists.map((artist) => (
                      <span className="taste-chip" key={artist.name}>
                        {artist.name}
                      </span>
                    ))}
                    {comparison.onlyTarget.genres.map((genre) => (
                      <span className="taste-chip is-muted" key={`g-${genre.name}`}>
                        <Music2 size={11} /> {genre.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {target ? (
        <div className="taste-footer">
          <Link className="button ghost" to={target.username ? `/u/${target.username}` : `/profile/${target.id}`}>
            {t('Profili aç', 'Open profile')}
          </Link>
          <Link className="button ghost" to="/community">
            {t('Mesaj gönder', 'Send a message')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
