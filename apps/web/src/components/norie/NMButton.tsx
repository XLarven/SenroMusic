import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'glass';
  children: ReactNode;
};

export function NMButton({ variant = 'primary', className, children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={clsx('nm-btn', `nm-btn--${variant}`, className)} {...rest}>
      {children}
    </button>
  );
}
