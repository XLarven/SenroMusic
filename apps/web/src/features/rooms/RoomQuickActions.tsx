import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Radio } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import { useToastStore } from '../../store/toast';
import type { Track } from '../../types';

function toRoomTrack(track: Track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album || null,
    coverUrl: track.coverUrl,
    source: track.format ?? null,
    duration: track.duration ?? null,
  };
}

/**
 * "Play in room" / "Add to room queue" for the track the user is looking at.
 * Renders nothing when the account is not in a room, and respects the room's
 * server-provided permissions.
 */
export function RoomQuickActions({ track }: { track: Track | null }) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.rooms(), staleTime: 15_000 });
  const room = rooms.data?.mine[0] ?? null;
  const detail = useQuery({
    queryKey: ['room', room?.id],
    queryFn: () => api.room(room!.id),
    enabled: Boolean(room?.id),
    staleTime: 10_000,
    retry: false,
  });

  if (!track || !room || !detail.data) return null;
  const canControl = detail.data.canControl;
  const canQueue = detail.data.canEditQueue;
  if (!canControl && !canQueue) return null;

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['room', room.id] });
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      pushToast(message, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('İşlem başarısız.', 'Action failed.'), 'error');
    }
  };

  return (
    <div className="room-quick">
      {canControl ? (
        <button
          type="button"
          className="button ghost compact"
          onClick={() =>
            void run(
              () => api.roomPlayback(room.id, { action: 'play-track', track: toRoomTrack(track) }),
              t('Odada çalıyor.', 'Playing in the room.'),
            )
          }
          disabled={detail.isFetching}
        >
          {detail.isFetching ? <Loader2 size={13} className="spin" /> : <Radio size={13} />}
          {t('Odada çal', 'Play in room')}
        </button>
      ) : null}
      {canQueue ? (
        <button
          type="button"
          className="button ghost compact"
          onClick={() =>
            void run(
              () => api.roomQueueAdd(room.id, toRoomTrack(track)),
              t('Oda sırasına eklendi.', 'Added to the room queue.'),
            )
          }
          disabled={detail.isFetching}
        >
          <Plus size={13} /> {t('Oda sırasına ekle', 'Add to room queue')}
        </button>
      ) : null}
    </div>
  );
}
