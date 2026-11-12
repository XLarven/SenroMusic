import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Eye, Headphones, Loader2, LockKeyhole, Search, UserRound, Users } from 'lucide-react';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { t } from '../lib/i18n';
import { TasteScore } from '../features/taste/tasteUi';
import { useToastStore } from '../store/toast';

/**
 * Community → Taste Match.
 *
 * The overview and the friend ranking come from real playback rows; discovery is
 * strictly opt-in and stays anonymous until both sides show interest.
 */
export function TasteMatchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const overview = useQuery({ queryKey: ['taste', 'me'], queryFn: () => api.tasteMe(), staleTime: 60_000 });
  const friends = useQuery({ queryKey: ['taste', 'friends'], queryFn: () => api.tasteFriends(24, 0), staleTime: 60_000 });
  const discovery = useQuery({ queryKey: ['taste', 'discover'], queryFn: () => api.tasteDiscover(12, 0), staleTime: 60_000 });

  const optIn = useMutation({
    mutationFn: (value: boolean) => api.updateSetting('tasteDiscoverable', value),
    onSuccess: async (_data, value) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taste', 'me'] }),
        queryClient.invalidateQueries({ queryKey: ['taste', 'discover'] }),
      ]);
      pushToast(
        value
          ? t('Keşif açıldı. Artık uygun dinleyiciler arasında görünüyorsun.', 'Discovery is on. Eligible listeners can find you.')
          : t('Keşiften ayrıldın.', 'You left discovery.'),
        'success',
      );
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : t('Ayar kaydedilemedi.', 'Could not save the setting.'), 'error'),
  });

  const like = useMutation({
    mutationFn: (userId: string) => api.tasteLike(userId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['taste', 'discover'] });
      if (result.mutual) {
        pushToast(t('Karşılıklı ilgi! İsimler açıldı.', 'Mutual interest — identities revealed.'), 'success');
      } else {
        pushToast(t('İlgin kaydedildi. Karşı taraf da ilgi gösterirse isimler açılır.', 'Interest saved. Names reveal when they do too.'), 'info');
      }
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : t('İlgi kaydedilemedi.', 'Could not record interest.'), 'error'),
  });

  const leave = useMutation({
    mutationFn: () => api.tasteLeaveDiscovery(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taste', 'me'] }),
        queryClient.invalidateQueries({ queryKey: ['taste', 'discover'] }),
      ]);
      pushToast(t('Keşiften ayrıldın ve beğeniler temizlendi.', 'You left discovery and your interests were cleared.'), 'success');
    },
  });

  const profile = overview.data?.profile;
  const settings = overview.data?.settings;
  const eligible = profile?.eligible ?? false;

  async function compare() {
    const value = query.trim();
    if (!value || searching) return;
    setSearching(true);
    try {
      const result = await api.searchUsers(value);
      const match =
        result.users.find((entry) => (entry.username ?? '').toLowerCase() === value.toLowerCase()) ?? result.users[0];
      if (!match) {
        pushToast(t('Kullanıcı bulunamadı.', 'No such user.'), 'error');
        return;
      }
      navigate(`/community/taste/${match.id}`);
    } catch {
      pushToast(t('Arama başarısız oldu.', 'Search failed.'), 'error');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="page taste-page">
      <header className="community-hero">
        <span className="eyebrow">{t('Topluluk', 'Community')}</span>
        <h1>{t('Zevk Uyumu', 'Taste Match')}</h1>
        <p>
          {t(
            'Gerçek dinleme geçmişinden hesaplanan müzik uyumu. Yüzdeler uydurulmaz, eksik veri cezalandırılmaz.',
            'Music compatibility computed from real listening history. Percentages are never invented and missing data is never punished.',
          )}
        </p>
        <div className="community-hero-meta">
          <Link className="status-pill" to="/community">
            <Users size={13} /> {t('Topluluğa dön', 'Back to community')}
          </Link>
          {profile ? (
            <span className="status-pill">
              <Headphones size={13} /> {profile.plays} {t('çalma', 'plays')}
            </span>
          ) : null}
        </div>
      </header>

      <section className="content-section" aria-label={t('Zevk özeti', 'Taste overview')}>
        <div className="section-heading">
          <div>
            <h2>{t('Senin zevkin', 'Your taste')}</h2>
            <p>{t('Son dinlemelerinden çıkan profil. Yalnız sen görüyorsun.', 'The profile distilled from your plays. Only you see this.')}</p>
          </div>
        </div>

        {overview.isPending ? (
          <div className="taste-loading">
            <Loader2 size={18} className="spin" /> {t('Yükleniyor', 'Loading')}
          </div>
        ) : !profile ? (
          <EmptyState
            icon={Headphones}
            title={t('Profil yüklenemedi.', 'Could not load your profile.')}
            description={t('Biraz bekleyip tekrar dene.', 'Wait a moment and try again.')}
            compact
          />
        ) : (
          <div className="taste-overview">
            <div className="taste-overview-main">
              <div className={`taste-eligible ${eligible ? 'is-ready' : 'is-thin'}`}>
                <strong>{profile.plays}</strong>
                <span>{t('geçerli çalma', 'qualifying plays')}</span>
                <small>
                  {profile.lastPlayedAt
                    ? t('Son dinleme', 'Last play') + ': ' + new Date(profile.lastPlayedAt).toLocaleDateString()
                    : t('Henüz dinleme yok', 'No plays yet')}
                </small>
              </div>
              {!eligible ? (
                <p className="taste-thin-note">
                  {t(
                    'Anlamlı bir yüzde için en az 5 çalma ve 3 farklı sanatçı gerekiyor. Şu an veri az; karşılaştırmalarda yüzde yerine açıklama gösterilir.',
                    'A meaningful percentage needs at least 5 plays across 3 artists. Data is thin right now, so comparisons show an explanation instead of a number.',
                  )}
                </p>
              ) : null}
              {profile.genres.length > 0 ? (
                <div className="taste-chips">
                  {profile.genres.slice(0, 6).map((genre) => (
                    <span className="taste-chip" key={genre.name}>
                      {genre.name} · {genre.plays}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="taste-thin-note">
                  {t('Tür bilgisi olmayan parçalar dinliyorsun; tür boyutu hesaba katılmıyor.', 'Your tracks have no genre tags, so the genre dimension is skipped.')}
                </p>
              )}
              {profile.languages.length > 0 ? (
                <p className="taste-langs">
                  <LockKeyhole size={12} /> {t('Dil', 'Languages')}: {profile.languages.map((entry) => entry.name).join(', ')}
                </p>
              ) : null}
            </div>

            <div className="taste-overview-list">
              <h3>{t('En çok dinlediğin sanatçılar', 'Most played artists')}</h3>
              <ol className="taste-top-list">
                {profile.artists.slice(0, 5).map((artist, index) => (
                  <li key={artist.name}>
                    <span className="taste-rank">{index + 1}</span>
                    <span className="taste-name">{artist.name}</span>
                    <small>{artist.plays}</small>
                  </li>
                ))}
                {profile.artists.length === 0 ? <li className="taste-name">{t('Henüz yok', 'Nothing yet')}</li> : null}
              </ol>
            </div>

            <div className="taste-overview-list">
              <h3>{t('En çok dinlediğin parçalar', 'Most played tracks')}</h3>
              <ul className="taste-track-list">
                {profile.tracks.slice(0, 4).map((track) => (
                  <li key={track.key}>
                    <Cover src={track.coverUrl} alt="" seed={track.title} className="taste-track-cover" iconSize={14} />
                    <span className="taste-name">
                      {track.title}
                      <small>{track.artist}</small>
                    </span>
                    <small>{track.plays}</small>
                  </li>
                ))}
                {profile.tracks.length === 0 ? <li className="taste-name">{t('Henüz yok', 'Nothing yet')}</li> : null}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="content-section" aria-label={t('Karşılaştır', 'Compare')}>
        <div className="section-heading">
          <div>
            <h2>{t('Birini karşılaştır', 'Compare with someone')}</h2>
            <p>{t('Kullanıcı adı yaz; karşı taraf izin veriyorsa uyumunu gör.', 'Type a username; if they allow it, you will see the match.')}</p>
          </div>
        </div>
        <div className="taste-compare-form">
          <label className="taste-input">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void compare();
              }}
              placeholder={t('Kullanıcı adı veya görünen ad', 'Username or display name')}
              aria-label={t('Kullanıcı ara', 'Search a user')}
            />
          </label>
          <button type="button" className="button" onClick={() => void compare()} disabled={searching || !query.trim()}>
            {searching ? <Loader2 size={15} className="spin" /> : <UserRound size={15} />}
            {t('Karşılaştır', 'Compare')}
          </button>
        </div>
      </section>

      <section className="content-section" aria-label={t('Uyumlu arkadaşlar', 'Compatible friends')}>
        <div className="section-heading">
          <div>
            <h2>{t('Uyumlu arkadaşlar', 'Compatible friends')}</h2>
            <p>{t('Arkadaşların arasında en yakın zevkler.', 'The closest taste among your friends.')}</p>
          </div>
        </div>

        {friends.isPending ? (
          <div className="taste-loading">
            <Loader2 size={18} className="spin" /> {t('Yükleniyor', 'Loading')}
          </div>
        ) : (friends.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={Users}
            title={t('Karşılaştırılacak arkadaş yok.', 'No friends to compare yet.')}
            description={t('Arkadaş ekledikçe burada uyum sıralaması oluşur.', 'A ranking appears as you add friends.')}
            compact
          />
        ) : (
          <div className="taste-grid">
            {friends.data?.items.map((entry) =>
              entry.user ? (
                <Link className="taste-card" key={entry.user.id} to={`/community/taste/${entry.user.id}`}>
                  <TasteScore score={entry.score} size="sm" />
                  <Cover src={entry.user.avatarUrl} alt="" seed={entry.user.id} className="taste-avatar" iconSize={16} />
                  <div className="taste-card-copy">
                    <strong>{entry.user.displayName}</strong>
                    <small>
                      {entry.score === null
                        ? t('Yeterli veri yok', 'Not enough data')
                        : t(
                            `${entry.sharedArtists} ortak sanatçı · ${entry.sharedTracks} ortak parça`,
                            `${entry.sharedArtists} shared artists · ${entry.sharedTracks} shared tracks`,
                          )}
                    </small>
                  </div>
                </Link>
              ) : null,
            )}
          </div>
        )}
      </section>

      <section className="content-section" aria-label={t('Keşif', 'Discovery')}>
        <div className="section-heading">
          <div>
            <h2>
              <Compass size={18} /> {t('Benzer dinleyiciler', 'Similar listeners')}
            </h2>
            <p>
              {t(
                'İsteğe bağlı keşif. Açmadığın sürece hiçbir listede görünmezsin.',
                'Optional discovery. You appear in no list until you turn it on.',
              )}
            </p>
          </div>
        </div>

        {!settings?.discoverable ? (
          <div className="taste-optin">
            <Eye size={20} />
            <div>
              <strong>{t('Keşfe katıl', 'Join discovery')}</strong>
              <p>
                {t(
                  'Uyum skorun paylaşılır, ismin yalnızca karşılıklı ilgi olursa açılır. Dilediğin an ayrılabilirsin.',
                  'Your match score is shared; your name appears only after mutual interest. You can leave any time.',
                )}
              </p>
            </div>
            <button type="button" className="button" onClick={() => optIn.mutate(true)} disabled={!eligible || optIn.isPending}>
              {optIn.isPending ? <Loader2 size={15} className="spin" /> : <Compass size={15} />}
              {t('Keşfi aç', 'Turn on discovery')}
            </button>
          </div>
        ) : (
          <>
            <div className="taste-discovery-head">
              <span className="status-pill">
                <Compass size={13} /> {t('Keşif açık', 'Discovery on')}
              </span>
              <button type="button" className="button ghost compact" onClick={() => leave.mutate()} disabled={leave.isPending}>
                {leave.isPending ? <Loader2 size={14} className="spin" /> : null}
                {t('Keşiften ayrıl', 'Leave discovery')}
              </button>
            </div>

            {discovery.isPending ? (
              <div className="taste-loading">
                <Loader2 size={18} className="spin" /> {t('Yükleniyor', 'Loading')}
              </div>
            ) : (discovery.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={Compass}
                title={t('Şimdilik eşleşme yok.', 'No matches yet.')}
                description={t('Keşfe katılan dinleyiciler burada listelenir.', 'Listeners who join discovery appear here.')}
                compact
              />
            ) : (
              <div className="taste-grid">
                {discovery.data?.items.map((entry) => {
                  const anonymous = entry.anonymous;
                  const name = entry.user?.displayName ?? t('Anonim dinleyici', 'Anonymous listener');
                  return (
                    <article className="taste-card is-discovery" key={entry.matchId}>
                      <TasteScore score={entry.score} size="sm" />
                      {anonymous ? (
                        <span className="taste-anon" aria-hidden="true">
                          <Compass size={18} />
                        </span>
                      ) : (
                        <Cover src={entry.user?.avatarUrl ?? null} alt="" seed={entry.matchId} className="taste-avatar" iconSize={16} />
                      )}
                      <div className="taste-card-copy">
                        <strong>{name}</strong>
                        <small>
                          {entry.sharedArtists} {t('ortak sanatçı', 'shared artists')} · {entry.sharedGenres}{' '}
                          {t('ortak tür', 'shared genres')}
                        </small>
                      </div>
                      {entry.mutual && entry.user ? (
                        <Link className="button ghost compact" to={`/community/taste/${entry.user.id}`}>
                          {t('Karşılaştır', 'Compare')}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="button ghost compact"
                          onClick={() => like.mutate(entry.matchId)}
                          disabled={entry.liked || like.isPending}
                        >
                          {entry.liked ? t('İlgi gönderildi', 'Interest sent') : t('İlgileniyorum', 'Interested')}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
