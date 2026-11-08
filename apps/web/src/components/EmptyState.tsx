import { createElement, isValidElement, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

type EmptyStateProps = {
  icon: LucideIcon | ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={clsx('empty-state', compact && 'empty-state-compact', className)}>
      <div className="empty-state-icon">
        {isValidElement(Icon) ? Icon : createElement(Icon as LucideIcon, { size: 26, strokeWidth: 1.7 })}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
