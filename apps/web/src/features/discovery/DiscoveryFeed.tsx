import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Play, RefreshCw, Sparkles, TriangleAlert, UserX } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import { usePlayer } from '../../store/player';
import { useToastStore } from '../../store/toast';
import type { DiscoveryItem, DiscoveryPayload, DiscoverySection, Track } from '../../types';

function toTrack(item: DiscoveryItem): Track {
  const videoId = item.id.startsWith('yt_') ? item.id.slice(3) : item.id;
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: 'YouTube',
    albumArtist: item.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: item.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'youtube',
    size: 0,
    coverUrl: item.thumbnail,
    streamUrl: `youtube:${videoId}`,
    addedAt: new Date().toISOString(),
  };
}

function sectionTitle(section: DiscoverySection): string {
  switch (section.key) {
    case 'madeForYou':
      return t('Senin için', 'Made for you');
    case 'becauseYouListened':
      return section.seed?.artist
        ? t(`${section.seed.artist} dinlediğin için`, `Because you listened to ${section.seed.artist}`)
        : t('Dinlediklerine göre', 'Because you listened');
    case 'discoverSomethingNew':
      return t('Yeni bir şey keşfet', 'Discover something new');
    case 'hiddenGems':
      return t('Az bilinenler', 'Hidden gems');
    default:
      return t('Rastgele keşif', 'Random discovery');
  }
}

/**
 * Home discovery feed.
 *
 * Every row is a real, playable YouTube result from the server's similar-track
 * pipeline. Server-side feedback (not interested / less from artist) removes the
 * item from the next build, and sections with no candidates are never rendered.
 */
export function DiscoveryFeed() {
  const queryClient = useQueryClient();
  const playQueue = usePlayer((state) => state.playQueue);
  const playTrack = usePlayer((state) => state.playTrack);
  const pushToast = useToastStore((state) => state.push);
  const [refreshing, setRefreshing] = useState(false);

  const discovery = useQuery({
    queryKey: ['discovery'],
    queryFn: () => api.discovery(),
    staleTime: 2 * 60_000,
    retry: false,
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await api.discovery(true);
      queryClient.setQueryData(['discovery'], payload);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Öneriler yenilenemedi.', 'Could not refresh.'), 'error');
    } finally {
      setRefreshing(false);
    }
  }, [pushToast, queryClient]);

  const feedback = useCallback(
    async (item: DiscoveryItem, kind: 'track' | 'artist') => {
      try {
        await api.discoveryFeedback({ kind, title: item.title, artist: item.artist });
        pushToast(
          kind === 'artist'
            ? t('Bu sanatçıdan daha az önerilecek.', 'Fewer recommendations from this artist.')
            : t('Bu parça önerilmeyecek.', 'This track will be hidden.'),
          'success',
        );
        const payload: DiscoveryPayload | undefined = queryClient.getQueryData(['discovery']);
        if (payload) {
          queryClient.setQueryData(['discovery'], {
            ...payload,
            sections: payload.sections.map((section) => ({
              ...section,
              items: section.items.filter((candidate) =>
                kind === 'artist'
                  ? candidate.artist.toLowerCase() !== item.artist.toLowerCase()
                  : candidate.id !== item.id,
              ),
            })),
          });
        }
        void queryClient.invalidateQueries({ queryKey: ['discovery'] });
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('İşlem başarısız.', 'Action failed.'), 'error');
      }
    },
    [pushToast, queryClient],
  );

  const payload = discovery.data;
  const visibleSections = (payload?.sections ?? []).filter((section) => section.items.length > 0);

  if (discovery.isPending) {
    return (
      <section className="content-section discovery-section" aria-label={t('Keşfet', 'Discover')}>
        <div className="section-heading">
          <div>
            <h2>
              <Sparkles size={18} /> {t('Keşfet', 'Discover')}
            </h2>
            <p>{t('Senin için gerçek müzik aranıyor…', 'Finding real music for you…')}</p>
          </div>
        </div>
        <div className="discovery-skeleton">
          {[0, 1, 2].map((index) => (
            <div className="discovery-skeleton-card" key={index}>
              <span />
              <span />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (discovery.isError) {
    return (
      <section className="content-section discovery-section" aria-label={t('Keşfet', 'Discover')}>
        <div className="discovery-notice">
          <TriangleAlert size={18} />
          <div>
            <strong>{t('Öneriler şu an yüklenemedi.', 'Recommendations could not load.')}</strong>
            <p>{t('Sağlayıcıya ulaşılamıyor. Kütüphanen çalışmaya devam ediyor.', 'The provider is unreachable. Your library keeps working.')}</p>
          </div>
          <button type="button" className="button ghost compact" onClick={() => void discovery.refetch()}>
            <RefreshCw size={14} /> {t('Tekrar dene', 'Retry')}
          </button>
        </div>
      </section>
    );
  }

  if (!payload || visibleSections.length === 0) {
    return (
      <section className="content-section discovery-section" aria-label={t('Keşfet', 'Discover')}>
        <div className="discovery-notice">
          <TriangleAlert size={18} />
          <div>
            <strong>{t('Şu an öneri üretilemiyor.', 'No recommendations right now.')}</strong>
            <p>
              {t(
                'Müzik sağlayıcısı yanıt vermedi. Birkaç şarkı dinledikten sonra yeniden dene.',
                'The music provider did not answer. Try again after listening to a few songs.',
              )}
            </p>
          </div>
          <button type="button" className="button ghost compact" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {t('Yenile', 'Refresh')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="content-section discovery-section" aria-label={t('Keşfet', 'Discover')}>
      <div className="section-heading">
        <div>
          <h2>
            <Sparkles size={18} /> {payload.personalized ? t('Senin için keşfet', 'Discover for you') : t('Keşfet', 'Discover')}
          </h2>
          <p>
            {payload.personalized
              ? t('Dinleme geçmişinden üretilen gerçek öneriler.', 'Real recommendations built from your listening.')
              : t('Kütüphanenden başlangıç önerileri.', 'Starter picks from your library.')}
          </p>
        </div>
        <button type="button" className="button ghost compact" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          {t('Yenile', 'Refresh')}
        </button>
      </div>

      <div className="discovery-sections">
        {visibleSections.map((section) => (
          <div className="discovery-row" key={section.key}>
            <div className="discovery-row-head">
              <h3>{sectionTitle(section)}</h3>
              <button
                type="button"
                className="discovery-play-all"
                onClick={() => playQueue(section.items.map(toTrack))}
              >
                <Play size={12} fill="currentColor" /> {t('Tümünü çal', 'Play all')}
              </button>
            </div>
            <div className="discovery-cards">
              {section.items.map((item) => (
                <article className="discovery-card" key={`${section.key}-${item.id}`}>
                  <button
                    type="button"
                    className="discovery-cover-button"
                    onClick={() => playTrack(toTrack(item))}
                    aria-label={`${item.title} ${t('çal', 'play')}`}
                  >
                    <Cover
                      src={item.thumbnail}
                      alt=""
                      seed={item.id}
                      className="discovery-cover"
                      iconSize={18}
                      eager={false}
                    />
                    <span className="discovery-play">
                      <Play size={16} fill="currentColor" />
                    </span>
                  </button>
                  <div className="discovery-copy">
                    <strong title={item.title}>{item.title}</strong>
                    <small title={item.artist}>{item.artist}</small>
                  </div>
                  <div className="discovery-actions">
                    <button
                      type="button"
                      className="icon-button subtle"
                      onClick={() => void feedback(item, 'track')}
                      aria-label={t('İlgilenmiyorum', 'Not interested')}
                      title={t('İlgilenmiyorum', 'Not interested')}
                    >
                      <Ban size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-button subtle"
                      onClick={() => void feedback(item, 'artist')}
                      aria-label={t('Bu sanatçıdan az göster', 'Show less from this artist')}
                      title={t('Bu sanatçıdan az göster', 'Show less from this artist')}
                    >
                      <UserX size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
