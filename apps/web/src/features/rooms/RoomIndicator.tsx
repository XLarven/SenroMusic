import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Headphones, LogOut, Radio, Users } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import { subscribeRealtime } from '../../lib/presence';
import { useToastStore } from '../../store/toast';

/**
 * Compact "you are still in a room" bar.
 *
 * Membership is server-side and does not end when the page changes, so this
 * indicator appears on every screen and gives a one-click way back or out.
 */
export function RoomIndicator() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.rooms(), staleTime: 15_000 });
  const room = rooms.data?.mine[0] ?? null;

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'room_state' || event.type === 'room_members' || event.type === 'room_closed') {
        void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  if (!room) return null;

  const leave = async () => {
    try {
      await api.leaveRoom(room.id);
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      pushToast(t('Odadan ayrıldın.', 'You left the room.'), 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Odadan ayrılamadın.', 'Could not leave the room.'), 'error');
    }
  };

  return (
    <div className="room-indicator" role="status">
      <span className="room-indicator-icon">
        <Radio size={16} />
      </span>
      <Link className="room-indicator-copy" to={`/rooms/${room.id}`}>
        <strong>{room.name}</strong>
        <small>
          {room.nowPlaying ? `${room.nowPlaying.title} · ${room.nowPlaying.artist}` : t('Henüz şarkı yok', 'No track yet')}
        </small>
      </Link>
      <span className="room-indicator-meta">
        <Users size={12} /> {room.memberCount}
      </span>
      <Link className="button compact" to={`/rooms/${room.id}`}>
        <Headphones size={13} /> {t('Odaya dön', 'Return')}
      </Link>
      <button
        type="button"
        className="icon-button subtle"
        onClick={() => {
          void leave();
          navigate('/rooms');
        }}
        aria-label={t('Odadan ayrıl', 'Leave room')}
        title={t('Odadan ayrıl', 'Leave room')}
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
