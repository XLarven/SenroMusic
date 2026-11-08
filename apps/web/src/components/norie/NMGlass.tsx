import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  style?: CSSProperties;
};

export function NMGlassSurface({ className, children, style, ...rest }: Props) {
  return (
    <div className={clsx('nm-glass', className)} style={style} {...rest}>
      {children}
    </div>
  );
}
