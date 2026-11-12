import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Headphones, Loader2, Plus, Radio, Users } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';

/**
 * Community entry point for listening rooms. Real rooms only: when nobody is
 * listening the panel invites the user to open the first one.
 */
export function ListeningRoomsPanel() {
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.rooms(), staleTime: 15_000 });

  if (rooms.isPending) {
    return (
      <div className="taste-loading">
        <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
      </div>
    );
  }

  const mine = rooms.data?.mine ?? [];
  const invites = rooms.data?.invites ?? [];
  const publicRooms = (rooms.data?.publicRooms ?? []).filter(
    (room) => !mine.some((entry) => entry.id === room.id),
  );
  const featured = [...invites.map((room) => ({ room, invited: true })), ...publicRooms.map((room) => ({ room, invited: false }))].slice(0, 3);

  return (
    <div className="room-mini">
      {invites.length > 0 ? (
        <p className="room-mini-invite">
          <Radio size={13} /> {t(`${invites.length} davet bekliyor`, `${invites.length} invitations waiting`)}
        </p>
      ) : null}

      {mine.length > 0 ? (
        <p className="room-mini-mine">
          {t('İçinde olduğun oda:', 'You are in:')}{' '}
          <Link to={`/rooms/${mine[0].id}`}>
            {mine[0].name} <ArrowUpRight size={12} />
          </Link>
        </p>
      ) : null}

      {featured.length === 0 ? (
        <p className="room-mini-empty">
          <Headphones size={15} />
          {t('Şu an açık oda yok. İlkini sen aç.', 'No rooms open right now. Open the first one.')}
        </p>
      ) : (
        <ul className="room-mini-list">
          {featured.map(({ room, invited }) => (
            <li key={room.id}>
              <Cover
                src={room.nowPlaying?.coverUrl ?? null}
                alt=""
                seed={room.id}
                className="room-mini-cover"
                iconSize={12}
              />
              <Link className="taste-name" to={`/rooms/${room.id}`}>
                {room.name}
                <small>
                  {room.ownerName} · {room.memberCount} {t('kişi', 'people')}
                  {invited ? ` · ${t('davet', 'invite')}` : ''}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="room-mini-actions">
        <Link className="button compact" to="/rooms">
          <Plus size={14} /> {t('Oda aç / katıl', 'Create / join')}
        </Link>
        <Link className="taste-more" to="/rooms">
          <Users size={12} /> {t('Tüm odalar', 'All rooms')} <ArrowUpRight size={12} />
        </Link>
      </div>
    </div>
  );
}
