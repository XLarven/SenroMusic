import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
};

export function NMSearchBar({ value, onChange, placeholder = 'Ara', children }: Props) {
  return (
    <div className="nm-search" role="search">
      <Search size={18} aria-hidden="true" style={{ color: 'var(--nm-text-secondary)', flexShrink: 0 }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Ara"
        autoComplete="off"
        spellCheck={false}
        type="search"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Temizle"
          style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer' }}
        >
          <X size={14} />
        </button>
      ) : null}
      {children}
    </div>
  );
}
