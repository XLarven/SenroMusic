import clsx from 'clsx';
import { Link } from 'react-router-dom';

type LogoProps = {
  compact?: boolean;
  asLink?: boolean;
  className?: string;
};

function Mark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function Logo({ compact = false, asLink = false, className }: LogoProps) {
  const content = (
    <>
      <Mark />
      {!compact ? (
        <span className="logo-word">
          Norie<span> Music</span>
        </span>
      ) : null}
    </>
  );

  if (asLink) {
    return (
      <Link to="/" className={clsx('logo', className)} aria-label="Norie Music ana sayfa">
        {content}
      </Link>
    );
  }

  return <span className={clsx('logo', className)}>{content}</span>;
}
