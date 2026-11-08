type Props = {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  label?: string;
};

export function NMSlider({ min, max, step = 0.1, value, onChange, label }: Props) {
  return (
    <input
      type="range"
      className="nm-range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label || 'Değer'}
    />
  );
}
