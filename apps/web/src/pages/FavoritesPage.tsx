import { Heart } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { useFavorites } from '../store/favorites';

export function FavoritesPage() {
  const { library } = useMusicData();
  const ids = useFavorites((s) => s.ids);
  const tracks = library.tracks.filter((t) => ids.includes(t.id));

  return (
    <div className="page">
      <header className="page-heading">
        <span className="eyebrow">Kitaplığın</span>
        <h1>Favoriler</h1>
        <p>{tracks.length} favori şarkı — kalbe dokun başkasında yok, her yerde seninle.</p>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Henüz favori yok"
          description="Şarkıların yanında kalp ikonuna dokun, burada toplansın."
        />
      ) : (
        <div className="surface-panel">
          <TrackList tracks={tracks} />
        </div>
      )}
    </div>
  );
}
