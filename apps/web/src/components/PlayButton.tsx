import { Loader2, Pause, Play } from 'lucide-react';
import clsx from 'clsx';
import type { Track } from '../types';
import { usePlayer } from '../store/player';

type PlayButtonProps = {
  tracks: Track[];
  index?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
};

export function PlayButton({ tracks, index = 0, size = 'md', className, label }: PlayButtonProps) {
  const current = usePlayer((state) => state.current);
  const playing = usePlayer((state) => state.playing);
  const loading = usePlayer((state) => state.loading);
  const playQueue = usePlayer((state) => state.playQueue);
  const toggle = usePlayer((state) => state.toggle);
  // Compare against the track this button *starts*, never the whole list: a
  // playlist row that merely contains the playing song must stay a play button.
  const target = tracks[index] ?? tracks[0] ?? null;
  const isCurrent = Boolean(current && target && current.id === target.id);
  const isPlaying = isCurrent && playing;
  const disabled = tracks.length === 0;

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (disabled) return;
    if (isCurrent) toggle();
    else playQueue(tracks, index);
  };

  return (
    <button
      type="button"
      className={clsx('play-button', `play-button-${size}`, className)}
      onClick={handleClick}
      disabled={disabled}
      aria-label={label ?? (isPlaying ? 'Duraklat' : 'Oynat')}
    >
      {isCurrent && loading ? (
        <Loader2 className="spin" size={size === 'lg' ? 26 : size === 'sm' ? 16 : 20} />
      ) : isPlaying ? (
        <Pause size={size === 'lg' ? 26 : size === 'sm' ? 16 : 20} fill="currentColor" />
      ) : (
        <Play size={size === 'lg' ? 26 : size === 'sm' ? 16 : 20} fill="currentColor" />
      )}
    </button>
  );
}
