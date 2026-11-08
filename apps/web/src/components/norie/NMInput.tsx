import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function NMInput({ label, error, id, ...rest }: Props) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
      {label}
      <input id={id} className="nm-input" {...rest} />
      {error ? <span style={{ color: '#ff8fa8', fontSize: '0.75rem' }}>{error}</span> : null}
    </label>
  );
}
