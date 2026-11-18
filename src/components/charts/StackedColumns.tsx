import { useState } from 'react';
import { useElementWidth, useTip, ChartFrame } from './ChartBase';
import { niceTicks, linScale } from '../../lib/chartMath';

export interface StackColumn {
  key: string;
  label: string;
  segments: { key: string; label: string; value: number; color: string }[];
}

interface Props {
  data: StackColumn[];
  format: (n: number) => string;
  height?: number;
  maxValue?: number;
  yAxisFormat?: (n: number) => string;
}

/** Vertical stacked columns (e.g. a monthly timeline split by category). Reuses the kit tooltip. */
export function StackedColumns({ data, format, height = 240, maxValue, yAxisFormat }: Props) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const [active, setActive] = useState<string | null>(null);

  const padTop = 12;
  const axisH = 24;
  const yAxisW = 40;
  const plotH = height - padTop - axisH;
  const plotLeft = yAxisW;
  const plotRight = width - 10;
  const plotW = Math.max(40, plotRight - plotLeft);

  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const rawMax = maxValue ?? Math.max(1, ...totals);
  const { ticks, niceMax } = niceTicks(rawMax, 4);
  const y = linScale(0, niceMax, padTop + plotH, padTop);
  const fmtY = yAxisFormat ?? format;

  const n = data.length || 1;
  const slot = plotW / n;
  const barW = Math.min(40, Math.max(5, slot * 0.62));
  const labelEvery = n > 12 ? Math.ceil(n / 10) : 1;

  const move = (e: React.MouseEvent, d: StackColumn, total: number) => {
    const rect = ref.current?.getBoundingClientRect();
    show(rect ? e.clientX - rect.left : 0, rect ? e.clientY - rect.top : 0, {
      title: d.label,
      color: d.segments.find((s) => s.value > 0)?.color ?? '#6366F1',
      rows: [
        ...d.segments.map((s) => ({ label: s.label, value: format(s.value), color: s.color })),
        { label: 'Total', value: format(total) },
      ],
    });
  };

  return (
    <ChartFrame innerRef={ref} tip={tip} width={width}>
      <svg width={width} height={height} role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#CBD5E1' : '#EEEEEE'} strokeWidth={1} />
            <text x={plotLeft - 6} y={y(t) + 3} textAnchor="end" className="tnum" fontSize={10} fill="#94A3B8">
              {fmtY(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = plotLeft + slot * i + slot / 2;
          const total = d.segments.reduce((s, x) => s + x.value, 0);
          const dim = active && active !== d.key;
          let acc = 0;
          const rects = d.segments.map((s, si) => {
            const yTop = y(acc + s.value);
            const yBot = y(acc);
            acc += s.value;
            const h = Math.max(0, yBot - yTop);
            if (h <= 0) return null;
            const isTop = si === d.segments.length - 1 || d.segments.slice(si + 1).every((x) => x.value <= 0);
            return (
              <rect
                key={s.key}
                className="anim-bar-v"
                style={{ animationDelay: `${i * 35}ms` }}
                x={cx - barW / 2}
                y={yTop}
                width={barW}
                height={h}
                fill={s.color}
                rx={isTop ? 3 : 0}
              />
            );
          });
          return (
            <g
              key={d.key}
              opacity={dim ? 0.55 : 1}
              onMouseMove={(e) => move(e, d, total)}
              onMouseEnter={() => setActive(d.key)}
              onMouseLeave={() => {
                setActive(null);
                hide();
              }}
              style={{ cursor: 'default' }}
            >
              <rect x={cx - slot / 2} y={padTop} width={slot} height={plotH} fill="transparent" />
              {rects}
              {i % labelEvery === 0 && (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill="#94A3B8">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
