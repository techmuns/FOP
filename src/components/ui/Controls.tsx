import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface Option<T extends string = string> {
  value: T;
  label: string;
  color?: string;
  hint?: string;
}

/** Styled dropdown (custom, keyboard-free click menu). */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  width = 220,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref} style={{ width }}>
      {label && <span className="mb-1 block text-[11px] font-medium text-mun-grey">{label}</span>}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] font-semibold text-mun-ink shadow-sm transition hover:border-mun-primary/40 hover:shadow"
      >
        <span className="flex items-center gap-2 truncate">
          {current?.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: current.color }} />}
          <span className="truncate">{current?.label ?? 'Select'}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-mun-grey transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-pop anim-fade">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-mun-offwhite ${
                o.value === value ? 'font-bold text-mun-primary' : 'font-medium text-mun-slate'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                {o.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />}
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="text-[11px] font-normal text-mun-grey">· {o.hint}</span>}
              </span>
              {o.value === value && <Check size={15} className="shrink-0 text-mun-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Segmented toggle — e.g. the +15 / +30 day scenario. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3.5 py-1.5 text-[12.5px]';
  return (
    <div className="inline-flex rounded-xl border border-black/10 bg-mun-offwhite p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-lg font-semibold transition ${pad} ${
              active ? 'bg-white text-mun-primary shadow-sm' : 'text-mun-grey hover:text-mun-slate'
            }`}
            style={active && o.color ? { color: o.color } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Styled range slider (coloured fill + thumb via the .mun-range class in index.css). */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  color = '#6366F1',
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  color?: string;
  ariaLabel?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mun-range w-full"
      style={{ ['--pct']: `${pct}%`, ['--mun-accent']: color } as CSSProperties}
    />
  );
}

/** On/off switch. */
export function Toggle({
  checked,
  onChange,
  label,
  color = '#6366F1',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  color?: string;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="inline-flex items-center gap-2">
      <span
        className="relative h-5 w-9 rounded-full transition"
        style={{ background: checked ? color : '#CECECE' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
      {label && <span className="text-[12.5px] font-medium text-mun-slate">{label}</span>}
    </button>
  );
}
