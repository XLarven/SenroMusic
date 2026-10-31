import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('empty-state', className)}>
      <div className="empty-state-icon">
        <Icon size={26} strokeWidth={1.7} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
