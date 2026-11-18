import { useElementWidth, useTip, ChartFrame, type TipRow } from './ChartBase';

export interface TimelineEvent {
  key: string;
  date: string; // ISO
  label: string;
  value?: string;
  color: string;
  tipRows?: TipRow[];
  note?: string;
}

/** A simple horizontal event timeline — fixed-size markers on a date axis (no bubbles). */
export function Timeline({ events, height = 132 }: { events: TimelineEvent[]; height?: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();

  const pts = events
    .map((e) => ({ ...e, t: Date.parse(e.date) }))
    .filter((e) => isFinite(e.t))
    .sort((a, b) => a.t - b.t);

  const padX = 46;
  const baseY = height / 2;
  const lo = pts.length ? pts[0].t : 0;
  const hi = pts.length ? pts[pts.length - 1].t : 1;
  const span = hi - lo || 1;
  const x = (t: number) => (pts.length <= 1 ? width / 2 : padX + ((t - lo) / span) * (width - 2 * padX));

  const fmtDate = (t: number) => {
    const d = new Date(t);
    return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(2)}`;
  };

  const move = (e: React.MouseEvent, ev: (typeof pts)[number]) => {
    const rect = ref.current?.getBoundingClientRect();
    show(rect ? e.clientX - rect.left : 0, baseY, {
      title: ev.label,
      color: ev.color,
      rows: ev.tipRows ?? [{ label: 'Listed', value: fmtDate(ev.t) }],
      note: ev.note,
    });
  };

  return (
    <ChartFrame innerRef={ref} tip={tip} width={width}>
      <svg width={width} height={height} role="img" className="overflow-visible">
        {/* axis */}
        <line x1={padX - 8} x2={width - padX + 8} y1={baseY} y2={baseY} stroke="#E2E8F0" strokeWidth={2} />
        {pts.map((ev, i) => {
          const cx = x(ev.t);
          const up = i % 2 === 0;
          const labelY = up ? baseY - 16 : baseY + 24;
          const valueY = up ? baseY - 30 : baseY + 38;
          return (
            <g key={ev.key} onMouseMove={(e) => move(e, ev)} onMouseLeave={hide} style={{ cursor: 'default' }}>
              <line x1={cx} x2={cx} y1={up ? baseY - 10 : baseY} y2={up ? baseY : baseY + 10} stroke={ev.color} strokeWidth={1.5} />
              <circle className="anim-pop" style={{ animationDelay: `${i * 50}ms` }} cx={cx} cy={baseY} r={5.5} fill={ev.color} stroke="#fff" strokeWidth={2} />
              <text x={cx} y={labelY} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#334155">
                {ev.label.length > 16 ? ev.label.slice(0, 15) + '…' : ev.label}
              </text>
              {ev.value && (
                <text x={cx} y={valueY} textAnchor="middle" className="tnum" fontSize={10} fontWeight={700} fill={ev.color}>
                  {ev.value}
                </text>
              )}
              <text x={cx} y={up ? baseY + 18 : baseY - 12} textAnchor="middle" className="tnum" fontSize={9} fill="#94A3B8">
                {fmtDate(ev.t)}
              </text>
            </g>
          );
        })}
        {pts.length === 0 && (
          <text x={width / 2} y={baseY} textAnchor="middle" fontSize={12} fill="#94A3B8">
            No dated events
          </text>
        )}
      </svg>
    </ChartFrame>
  );
}
