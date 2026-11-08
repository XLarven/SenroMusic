type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
};

export function NMToggle({ checked, onChange, label }: Props) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label || 'Aç/kapat'}
        className={`nm-toggle ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      />
      {label ? <span style={{ fontSize: '0.85rem' }}>{label}</span> : null}
    </label>
  );
}
