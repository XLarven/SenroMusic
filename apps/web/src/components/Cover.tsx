import { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';
import clsx from 'clsx';
import { coverGradient } from '../lib/gradient';

type CoverProps = {
  src?: string | null;
  alt: string;
  seed: string;
  className?: string;
  eager?: boolean;
  iconSize?: number;
};

export function Cover({ src, alt, seed, className, eager = false, iconSize = 28 }: CoverProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div className={clsx('cover', className)} style={coverGradient(seed)}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback" aria-hidden="true">
          <Music2 size={iconSize} strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}
