import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function TrackListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="track-list skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="track-row" key={index}>
          <Skeleton className="skeleton-index" />
          <div className="track-main">
            <Skeleton className="skeleton-title" />
            <Skeleton className="skeleton-subtitle" />
          </div>
          <Skeleton className="skeleton-album" />
          <Skeleton className="skeleton-duration" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="card-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, index) => (
        <div className="album-card" key={index}>
          <Skeleton className="skeleton-cover" />
          <Skeleton className="skeleton-title" />
          <Skeleton className="skeleton-subtitle" />
        </div>
      ))}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="page">
      <Skeleton className="skeleton-heading" />
      <Skeleton className="skeleton-hero" />
      <CardGridSkeleton cards={5} />
      <TrackListSkeleton rows={5} />
    </div>
  );
}
