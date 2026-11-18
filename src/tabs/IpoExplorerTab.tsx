import { useMemo, useState } from 'react';
import { Rocket, Factory, Banknote } from 'lucide-react';
import type { AppData, IPO } from '../types';
import { PageHeader, Card, CardHeader, MiniStat } from '../components/ui/Card';
import { SubTabs } from '../components/ui/Tabs';
import { Columns, type ColumnDatum } from '../components/charts/Columns';
import { fmtCr, num } from '../lib/format';
import { MUN, MONEY, colorAt } from '../lib/brand';
import { SoonNote } from './SoonNote';

type Seg = 'all' | 'mb' | 'sme';
const isSme = (i: IPO) => String(i.exchange).includes('SME');

export function IpoExplorerTab({ data }: { data: AppData }) {
  const [seg, setSeg] = useState<Seg>('all');

  const ipos = useMemo(() => {
    if (seg === 'mb') return data.ipos.filter((i) => !isSme(i));
    if (seg === 'sme') return data.ipos.filter((i) => isSme(i));
    return data.ipos;
  }, [data.ipos, seg]);

  const totalIssue = ipos.reduce((s, i) => s + (i.issue_size_cr || 0), 0);
  const totalOfs = ipos.reduce((s, i) => s + (i.ofs_cr || 0), 0);
  const mbCount = data.ipos.filter((i) => !isSme(i)).length;
  const smeCount = data.ipos.filter((i) => isSme(i)).length;

  // bucket by calendar quarter of listing date
  const cols: ColumnDatum[] = useMemo(() => {
    const buckets = new Map<string, { count: number; issue: number; ofs: number; year: number }>();
    for (const i of ipos) {
      if (!i.listing_date) continue;
      const d = new Date(i.listing_date);
      if (isNaN(d.getTime())) continue;
      const y = d.getUTCFullYear();
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const key = `${y} Q${q}`;
      const b = buckets.get(key) || { count: 0, issue: 0, ofs: 0, year: y };
      b.count++;
      b.issue += i.issue_size_cr || 0;
      b.ofs += i.ofs_cr || 0;
      buckets.set(key, b);
    }
    const years = [...new Set([...buckets.values()].map((b) => b.year))].sort();
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => ({
        key,
        label: key.replace(' ', "'").replace(/^(\d{2})(\d{2})/, '$2'),
        value: b.count,
        color: colorAt(years.indexOf(b.year)),
        valueLabel: String(b.count),
        tipRows: [
          { label: 'IPOs listed', value: num(b.count) },
          { label: 'Issue size', value: fmtCr(b.issue), color: MUN.primary },
          { label: 'Offer-for-Sale', value: fmtCr(b.ofs), color: MONEY.ofs },
        ],
        note: `${key} · ${seg === 'all' ? 'all boards' : seg === 'mb' ? 'mainboard' : 'SME'}`,
      }));
  }, [ipos, seg]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        icon={Rocket}
        title="IPO Explorer"
        subtitle={`${num(data.ipos.length)} IPOs across mainboard + SME, FY2023–FY2026 — the raw liquidity events we mine for wealth`}
        right={
          <SubTabs
            active={seg}
            onChange={(v) => setSeg(v as Seg)}
            tabs={[
              { key: 'all', label: 'All boards', color: MUN.primary },
              { key: 'mb', label: 'Mainboard', color: MUN.violet },
              { key: 'sme', label: 'SME', color: MUN.cyan },
            ]}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="IPOs in view" value={num(ipos.length)} sub={seg === 'all' ? 'mainboard + SME' : seg === 'mb' ? 'mainboard only' : 'SME only'} color={MUN.primary} />
        <MiniStat label="Mainboard" value={num(mbCount)} sub="NSE / BSE mainboard" color={MUN.violet} />
        <MiniStat label="SME" value={num(smeCount)} sub="NSE / BSE SME boards" color={MUN.cyan} />
        <MiniStat label="Offer-for-Sale" value={fmtCr(totalOfs)} sub={`of ${fmtCr(totalIssue)} raised`} color={MONEY.ofs} />
      </div>

      <Card>
        <CardHeader
          icon={Factory}
          title="IPOs by quarter"
          subtitle="When the liquidity events happened — hover a bar for issue size & Offer-for-Sale"
          accent={MUN.primary}
          right={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mun-offwhite px-2.5 py-1 text-[11px] font-semibold text-mun-slate">
              <Banknote size={13} className="text-mun-amber-dark" /> {fmtCr(totalOfs)} cashed out
            </span>
          }
        />
        {cols.length ? (
          <Columns data={cols} format={(n) => num(n)} yAxisFormat={(n) => num(n)} height={260} />
        ) : (
          <p className="py-10 text-center text-[12.5px] text-mun-grey">No listed IPOs with dates in this view.</p>
        )}
      </Card>

      <SoonNote
        title="Next: the full IPO Explorer"
        body="Searchable table of every IPO — issue price, fresh vs OFS split, promoter % before/after, sector and city — with sector and board filters and drill-through to each company's promoters."
      />
    </div>
  );
}
