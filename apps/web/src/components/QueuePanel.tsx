import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ListMusic, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { Cover } from './Cover';
import { EmptyState } from './EmptyState';
import { usePlayer } from '../store/player';
import { formatDuration } from '../lib/format';

export function QueuePanel() {
  const open = usePlayer((state) => state.queueOpen);
  const queue = usePlayer((state) => state.queue);
  const current = usePlayer((state) => state.current);
  const index = usePlayer((state) => state.index);
  const playing = usePlayer((state) => state.playing);
  const setQueueOpen = usePlayer((state) => state.setQueueOpen);
  const playAt = usePlayer((state) => state.playAt);
  const removeFromQueue = usePlayer((state) => state.removeFromQueue);
  const clearQueue = usePlayer((state) => state.clearQueue);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, setQueueOpen]);

  if (!open) return null;

  return createPortal(
    <div className="queue-layer">
      <div className="queue-backdrop" onMouseDown={() => setQueueOpen(false)} aria-hidden="true" />
      <aside className="queue-panel" role="dialog" aria-modal="true" aria-label="Oynatma sırası">
        <header className="queue-header">
          <div>
            <span className="eyebrow">Oynatma sırası</span>
            <h2>Sırada ne var?</h2>
            <p>{queue.length > 0 ? `${queue.length} parça` : 'Sıra boş'}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setQueueOpen(false)}
            aria-label="Sırayı kapat"
          >
            <X size={18} />
          </button>
        </header>

        <div className="queue-body">
          {queue.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title="Henüz bir şey çalmıyor"
              description="Kitaplığından bir parça başlat; sıradaki parçalar burada görünecek."
            />
          ) : (
            <div className="queue-list">
              {queue.map((track, trackIndex) => {
                const isCurrent = current?.id === track.id && trackIndex === index;
                return (
                  <button
                    type="button"
                    className={clsx('queue-item', isCurrent && 'is-current')}
                    key={`${track.id}-${trackIndex}`}
                    onClick={() => playAt(trackIndex)}
                  >
                    <Cover
                      src={track.coverUrl}
                      alt=""
                      seed={`${track.albumArtist}-${track.album}`}
                      className="queue-cover"
                      iconSize={14}
                    />
                    <span className="queue-copy">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                    {isCurrent && playing ? (
                      <span className="equalizer queue-equalizer" aria-label="Şu anda çalıyor">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      <span className="queue-duration">{formatDuration(track.duration)}</span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      className="queue-remove"
                      aria-label={`${track.title} parçasını sıradan çıkar`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFromQueue(trackIndex);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          removeFromQueue(trackIndex);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {queue.length > 0 ? (
          <footer className="queue-footer">
            <button type="button" className="button ghost compact" onClick={clearQueue}>
              <Trash2 size={15} />
              Sırayı temizle
            </button>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
