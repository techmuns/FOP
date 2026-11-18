import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  sortable?: boolean;
  sortValue?: (r: Row) => number | string;
  render: (r: Row, index: number) => ReactNode;
  /** heat background: return 0..1 intensity (null = none) */
  heat?: (r: Row) => number | null;
  heatScale?: 'gyr' | 'hue';
  heatColor?: string;
  headerHint?: string;
}

interface Props<Row> {
  columns: Column<Row>[];
  rows: Row[];
  getKey: (r: Row) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  onRowClick?: (r: Row) => void;
  activeKey?: string | null;
  maxHeight?: number;
  dense?: boolean;
  stickyHeader?: boolean;
}

/** interpolate green→gold→red for 'gyr' heat cells */
function gyr(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0, [16, 185, 129]], // green
    [0.5, [245, 158, 11]], // gold
    [1, [244, 63, 94]], // red
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (c >= stops[i][0] && c <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const f = (c - a[0]) / span;
  return [0, 1, 2].map((k) => Math.round(a[1][k] + (b[1][k] - a[1][k]) * f)) as [number, number, number];
}

function heatBg(t: number, scale: 'gyr' | 'hue', hue: string): string {
  const alpha = 0.1 + 0.5 * Math.max(0, Math.min(1, t));
  if (scale === 'gyr') {
    const [r, g, b] = gyr(t);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const h = hue.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function Table<Row>({
  columns,
  rows,
  getKey,
  initialSort,
  onRowClick,
  activeKey,
  maxHeight,
  dense = false,
  stickyHeader = true,
}: Props<Row>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort, columns]);

  const toggleSort = (c: Column<Row>) => {
    if (!c.sortable) return;
    setSort((s) =>
      s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }
    );
  };

  const cellPad = dense ? 'px-2.5 py-1.5' : 'px-3 py-2.5';

  return (
    <div
      className={`mun-scroll overflow-auto rounded-xl border border-black/[0.06]`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-[12.5px]">
        <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
          <tr className="bg-mun-primary-deep text-white">
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c)}
                  className={`${cellPad} text-${c.align ?? 'left'} font-semibold uppercase tracking-wide text-[11px] ${
                    c.sortable ? 'cursor-pointer select-none hover:bg-black/10' : ''
                  }`}
                  style={{ width: c.width }}
                  title={c.headerHint}
                >
                  <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                    {c.header}
                    {c.sortable &&
                      (isSorted ? (
                        sort!.dir === 'asc' ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="opacity-50" />
                      ))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const key = getKey(r);
            const isActive = activeKey != null && key === activeKey;
            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(r)}
                className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
                  isActive ? 'ring-2 ring-inset ring-mun-primary' : ''
                } hover:bg-mun-primary/[0.06]`}
                style={{ background: isActive ? 'rgba(99,102,241,0.08)' : i % 2 ? '#F8FAFC' : '#EEF2FF' }}
              >
                {columns.map((c) => {
                  const t = c.heat?.(r);
                  const bg = t != null ? heatBg(t, c.heatScale ?? 'gyr', c.heatColor ?? '#6366F1') : undefined;
                  return (
                    <td
                      key={c.key}
                      className={`${cellPad} text-${c.align ?? 'left'} align-middle`}
                      style={bg ? { background: bg } : undefined}
                    >
                      {c.render(r, i)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-mun-grey">
                No rows to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
