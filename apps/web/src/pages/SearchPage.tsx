import { useDeferredValue, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Disc3, Search, SearchX, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { coverGradient } from '../lib/gradient';
import { formatCount } from '../lib/format';

type SearchTab = 'all' | 'tracks' | 'albums' | 'artists';
const TABS: Array<{ id: SearchTab; label: string }> = [
  { id: 'all', label: 'Tümü' },
  { id: 'tracks', label: 'Şarkılar' },
  { id: 'albums', label: 'Albümler' },
  { id: 'artists', label: 'Sanatçılar' },
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('tr');
}

export function SearchPage() {
  const { library } = useMusicData();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const rawTab = params.get('tab');
  const tab: SearchTab = TABS.some((item) => item.id === rawTab) ? (rawTab as SearchTab) : 'all';
  const deferredQuery = useDeferredValue(query.trim());

  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const setTab = (value: SearchTab) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  const results = useMemo(() => {
    const needle = normalize(deferredQuery);
    if (!needle) {
      return { tracks: [], albums: [], artists: [] };
    }
    return {
      tracks: library.tracks.filter((track) =>
        [track.title, track.artist, track.album, track.albumArtist, track.genre].some((value) =>
          normalize(value).includes(needle),
        ),
      ),
      albums: library.albums.filter((album) =>
        [album.name, album.artist].some((value) => normalize(value).includes(needle)),
      ),
      artists: library.artists.filter((artist) => normalize(artist.name).includes(needle)),
    };
  }, [deferredQuery, library]);

  const total = results.tracks.length + results.albums.length + results.artists.length;

  const genres = useMemo(() => {
    const map = new Map<string, { count: number; coverUrl: string | null }>();
    for (const track of library.tracks) {
      if (!track.genre) continue;
      const current = map.get(track.genre);
      if (current) current.count += 1;
      else map.set(track.genre, { count: 1, coverUrl: track.coverUrl });
    }
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, value]) => ({ name, ...value }));
  }, [library.tracks]);

  const counts: Record<SearchTab, number> = {
    all: total,
    tracks: results.tracks.length,
    albums: results.albums.length,
    artists: results.artists.length,
  };

  return (
    <div className="page search-page">
      <header className="page-heading search-heading">
        <span className="eyebrow">Keşfet</span>
        <h1>Ne dinlemek istiyorsun?</h1>
        <p>Şarkı, albüm, sanatçı ve türlerde kütüphanenin tamamında ara.</p>
      </header>

      <div className="search-box">
        <Search size={22} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Şarkı, albüm veya sanatçı ara…"
          autoFocus
          aria-label="Kitaplıkta ara"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Aramayı temizle">
            <X size={17} />
          </button>
        ) : (
          <span className="search-hint">Kitaplığında {formatCount(library.stats.tracks)} parça</span>
        )}
      </div>

      {!query.trim() ? (
        <>
          {genres.length > 0 ? (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <h2>Türlere göz at</h2>
                  <p>Kütüphanendeki renklere göre keşfet.</p>
                </div>
              </div>
              <div className="genre-grid">
                {genres.map((genre) => (
                  <button
                    type="button"
                    key={genre.name}
                    className="genre-card"
                    style={coverGradient(genre.name)}
                    onClick={() => setQuery(genre.name)}
                  >
                    <span className="genre-icon">
                      <Sparkles size={19} />
                    </span>
                    <span>
                      <strong>{genre.name}</strong>
                      <small>{genre.count} parça</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Albümlerde keşfet</h2>
                <p>Arşivindeki tüm albümler.</p>
              </div>
            </div>
            <div className="card-grid album-grid">
              {library.albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Sanatçılar</h2>
                <p>Kütüphanende yer alan sanatçılar.</p>
              </div>
            </div>
            <div className="card-grid artist-grid">
              {library.artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="search-tabs" role="tablist" aria-label="Arama sonucu filtreleri">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={clsx('filter-chip', tab === item.id && 'is-active')}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <span>{counts[item.id]}</span>
              </button>
            ))}
          </div>

          {total === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Sonuç bulunamadı"
              description={`“${deferredQuery}” için kütüphanende eşleşen bir şarkı, albüm veya sanatçı yok. Farklı bir ifade deneyebilirsin.`}
              action={
                <button type="button" className="button secondary" onClick={() => setQuery('')}>
                  Aramayı temizle
                </button>
              }
            />
          ) : (
            <div className="search-results">
              {results.tracks.length > 0 && (tab === 'all' || tab === 'tracks') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Şarkılar</h2>
                      <p>{results.tracks.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="surface-panel">
                    <TrackList tracks={tab === 'all' ? results.tracks.slice(0, 6) : results.tracks} />
                  </div>
                </section>
              ) : null}

              {results.albums.length > 0 && (tab === 'all' || tab === 'albums') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Albümler</h2>
                      <p>{results.albums.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="card-grid album-grid">
                    {results.albums.map((album) => (
                      <AlbumCard key={album.id} album={album} />
                    ))}
                  </div>
                </section>
              ) : null}

              {results.artists.length > 0 && (tab === 'all' || tab === 'artists') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Sanatçılar</h2>
                      <p>{results.artists.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="card-grid artist-grid">
                    {results.artists.map((artist) => (
                      <ArtistCard key={artist.id} artist={artist} />
                    ))}
                  </div>
                </section>
              ) : null}

              {tab !== 'all' && counts[tab] === 0 ? (
                <EmptyState
                  icon={Disc3}
                  title="Bu kategoride sonuç yok"
                  description="Diğer sonuç türlerine göz atabilir veya aramayı değiştirebilirsin."
                  action={
                    <button type="button" className="button secondary" onClick={() => setTab('all')}>
                      Tüm sonuçları göster
                    </button>
                  }
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
