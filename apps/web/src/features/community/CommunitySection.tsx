import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { t } from '../../lib/i18n';

type CommunitySectionProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Bullet list of what the section will do once it ships. */
  bullets?: string[];
  /** False only when the section is genuinely usable today. */
  comingSoon?: boolean;
  children?: ReactNode;
  className?: string;
};

/**
 * One block of the community page. Everything that is not implemented yet says
 * so, instead of pretending to work.
 */
export function CommunitySection({
  icon: Icon,
  title,
  description,
  bullets,
  comingSoon = false,
  children,
  className,
}: CommunitySectionProps) {
  return (
    <section className={clsx('community-card', className)} aria-label={title}>
      <header className="community-card-head">
        <span className="community-icon">
          <Icon size={20} />
        </span>
        <div className="community-card-copy">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {comingSoon ? (
          <span className="status-pill community-soon">{t('Yakında', 'Coming soon')}</span>
        ) : null}
      </header>

      {bullets && bullets.length > 0 ? (
        <ul className="community-points">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}

      {children}
    </section>
  );
}
