import { Music2 } from 'lucide-react';
import { t } from '../../lib/i18n';
import type { TasteComparison, TasteDimension } from '../../types';

/** Colour ramp for the score: low stays neutral, high warms up. */
export function scoreTone(score: number | null): 'none' | 'low' | 'mid' | 'high' {
  if (score === null) return 'none';
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export function dimensionLabel(key: TasteDimension['key']): string {
  switch (key) {
    case 'artists':
      return t('Sanatçılar', 'Artists');
    case 'tracks':
      return t('Parçalar', 'Tracks');
    case 'genres':
      return t('Türler', 'Genres');
    default:
      return t('Dinleme sıklığı', 'Listening frequency');
  }
}

/** Big percentage with a thin progress ring. Null renders an em dash. */
export function TasteScore({
  score,
  size = 'md',
  label,
}: {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const tone = scoreTone(score);
  const value = score ?? 0;
  return (
    <div
      className={`taste-score is-${tone} is-${size}`}
      style={{ ['--taste-value' as string]: `${value * 3.6}deg` }}
      aria-label={score === null ? t('Yeterli veri yok', 'Not enough data') : `${score}%`}
    >
      <div className="taste-score-inner">
        <strong>{score === null ? '—' : `${score}%`}</strong>
        {label ? <small>{label}</small> : null}
      </div>
    </div>
  );
}

/** Deterministic, human explanation of the number above it. */
export function TasteExplanation({ comparison }: { comparison: TasteComparison }) {
  const { score, reason, insufficient, dimensions, sharedArtists, sharedGenres, onlyViewer, onlyTarget } = comparison;

  if (score === null) {
    const who =
      insufficient.viewer && insufficient.target
        ? t('ikiniz de', 'both of you')
        : insufficient.viewer
          ? t('sen', 'you')
          : t('karşı taraf', 'the other listener');
    return (
      <p className="taste-explain">
        {reason === 'insufficient_history'
          ? t(
              `Karşılaştırma için yeterli dinleme geçmişi yok: ${who} henüz yeterince şarkı dinlememiş. Az veriyle yüzde üretmek yanıltıcı olur; birkaç şarkı dinledikten sonra tekrar bak.`,
              `There is not enough listening history to compare: ${who} has not listened enough yet. A percentage from thin data would be misleading, so try again after a few more plays.`,
            )
          : t('Ortak bir boyut bulunamadı.', 'No shared dimension could be computed.')}
      </p>
    );
  }

  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const sentences: string[] = [];

  if (score >= 70) {
    sentences.push(
      t(
        'Zevkiniz belirgin biçimde örtüşüyor; aynı şarkıları aynı sıklıkta dinliyorsunuz.',
        'Your taste clearly overlaps — you play the same songs at a similar rate.',
      ),
    );
  } else if (score >= 40) {
    sentences.push(
      t(
        'Kısmen örtüşen bir zevkiniz var: ortak bir çekirdek, iki ayrı kanat.',
        'Your taste partly overlaps: one shared core, two separate wings.',
      ),
    );
  } else {
    sentences.push(
      t(
        'Zevkleriniz ayrı düşüyor. Bu bir eksik değil — birbirinize yeni müzik katabileceğiniz anlamına gelir.',
        'Your taste sits far apart. That is not a flaw — it means you can add new music to each other.',
      ),
    );
  }

  if (strongest && strongest.score > 0) {
    sentences.push(
      t(
        `En güçlü ortak nokta ${dimensionLabel(strongest.key).toLowerCase()} (%${Math.round(
          strongest.score * 100,
        )}).`,
        `The strongest shared point is ${dimensionLabel(strongest.key).toLowerCase()} (${Math.round(
          strongest.score * 100,
        )}%).`,
      ),
    );
  }
  if (weakest && weakest.key !== strongest?.key && weakest.score < 0.3 && score >= 40) {
    sentences.push(
      t(
        `${dimensionLabel(weakest.key)} tarafında belirgin bir ayrışma var.`,
        `There is a clear split on ${dimensionLabel(weakest.key).toLowerCase()}.`,
      ),
    );
  }

  if (sharedArtists.length > 0) {
    const names = sharedArtists.slice(0, 3).map((entry) => entry.name).join(', ');
    sentences.push(t(`Ortak sanatçılar: ${names}.`, `Shared artists: ${names}.`));
  } else if (sharedGenres.length > 0) {
    const names = sharedGenres.slice(0, 3).map((entry) => entry.name).join(', ');
    sentences.push(t(`Ortak türler: ${names}.`, `Shared genres: ${names}.`));
  } else if (onlyViewer.artists[0] && onlyTarget.artists[0]) {
    sentences.push(
      t(
        `Ortak sanatçı yok; sen ${onlyViewer.artists[0].name} dinliyorsun, o ${onlyTarget.artists[0].name}.`,
        `No shared artist; you listen to ${onlyViewer.artists[0].name}, they listen to ${onlyTarget.artists[0].name}.`,
      ),
    );
  }

  if (comparison.sharedHidden) {
    sentences.push(
      t(
        'Ortak sanatçı ve parça listeleri gizlilik ayarları nedeniyle paylaşılmıyor.',
        'Shared artists and tracks are hidden by privacy settings.',
      ),
    );
  }

  return <p className="taste-explain">{sentences.join(' ')}</p>;
}

export function TasteDimensionBars({ dimensions }: { dimensions: TasteDimension[] }) {
  if (dimensions.length === 0) return null;
  const total = dimensions.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  return (
    <div className="taste-dims">
      {dimensions.map((entry) => (
        <div className="taste-dim" key={entry.key}>
          <div className="taste-dim-head">
            <span>{dimensionLabel(entry.key)}</span>
            <strong>{Math.round(entry.score * 100)}%</strong>
          </div>
          <div className="taste-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(entry.score * 100)}%` }} />
          </div>
          <small>
            {t('Ağırlık', 'Weight')} {Math.round((entry.weight / total) * 100)}%
          </small>
        </div>
      ))}
    </div>
  );
}

export function EmptyTaste({ text }: { text: string }) {
  return (
    <div className="taste-empty">
      <Music2 size={18} />
      <p>{text}</p>
    </div>
  );
}
