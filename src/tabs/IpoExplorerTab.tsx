import { useEffect, useMemo, useState } from 'react';
import { Rocket, Factory, PieChart, Scale, Search, X } from 'lucide-react';
import type { AppData, IPO } from '../types';
import { PageHeader, Card, CardHeader, MiniStat, Badge } from '../components/ui/Card';
import { SubTabs } from '../components/ui/Tabs';
import { Dropdown } from '../components/ui/Controls';
import { Table, type Column } from '../components/ui/Table';
import { StackedColumns, type StackColumn } from '../components/charts/StackedColumns';
import { StackedBar } from '../components/charts/StackedBar';
import { Donut, type DonutDatum } from '../components/charts/Donut';
import { fmtCr, num, pct, dateLabel } from '../lib/format';
import { MUN, MONEY, sectorColor } from '../lib/brand';

type Seg = 'all' | 'mb' | 'sme';
const isSme = (i: IPO) => String(i.exchange).includes('SME');
const companyShort = (s: string) => s.replace(/\s+(Ltd\.?|Limited)\.?$/i, '').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const exchColor = (e: string) => (e === 'NSE' ? MUN.primary : e === 'BSE' ? MUN.violet : e.includes('BSE') ? MUN.amber : MUN.cyan);

function leadPromoter(i: IPO): string | null {
  const promoters = (i.promoters || []).filter((p) => p.is_promoter);
  if (!promoters.length) return (i.promoters || [])[0]?.name ?? null;
  return [...promoters].sort((a, b) => (b.ofs_cr || 0) - (a.ofs_cr || 0))[0].name;
}

function SplitBar({ fresh, ofs }: { fresh: number | null; ofs: number | null }) {
  const total = (fresh || 0) + (ofs || 0);
  if (!total) return <span className="text-mun-grey">—</span>;
  const fp = ((fresh || 0) / total) * 100;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex h-2.5 w-16 overflow-hidden rounded-full">
        <div style={{ width: `${fp}%`, background: MUN.primary }} />
        <div style={{ width: `${100 - fp}%`, background: MONEY.ofs }} />
      </div>
      <span className="tnum text-[10px] text-mun-grey">{Math.round(fp)}/{Math.round(100 - fp)}</span>
    </div>
  );
}

export function IpoExplorerTab({
  data,
  onOpenPromoter,
  focusCompany,
  onClearFocus,
}: {
  data: AppData;
  onOpenPromoter: (person: string) => void;
  focusCompany?: string | null;
  onClearFocus?: () => void;
}) {
  const [seg, setSeg] = useState<Seg>('all');
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');

  // when opened from a Promoter 360 company card, filter to & highlight that IPO
  useEffect(() => {
    if (focusCompany) {
      setSeg('all');
      setYear('all');
      setQ(focusCompany);
    }
  }, [focusCompany]);
  const focusId = focusCompany ? data.ipos.find((i) => i.company === focusCompany)?.id ?? null : null;

  const yearOpts = useMemo(() => {
    const ys = new Set<string>();
    for (const i of data.ipos) if (i.listing_date) ys.add(String(new Date(i.listing_date).getUTCFullYear()));
    return [{ value: 'all', label: 'All years' }, ...[...ys].sort((a, b) => Number(b) - Number(a)).map((v) => ({ value: v, label: v }))];
  }, [data.ipos]);

  const ipos = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.ipos.filter((i) => {
      if (seg === 'mb' && isSme(i)) return false;
      if (seg === 'sme' && !isSme(i)) return false;
      if (year !== 'all' && !(i.listing_date && String(new Date(i.listing_date).getUTCFullYear()) === year)) return false;
      if (needle && !i.company.toLowerCase().includes(needle) && !(i.ticker || '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data.ipos, seg, year, q]);

  // ---- chart 1: IPOs per month, stacked mainboard vs SME ----
  const timeline: StackColumn[] = useMemo(() => {
    const buckets = new Map<string, { mb: number; sme: number }>();
    for (const i of ipos) {
      if (!i.listing_date) continue;
      const d = new Date(i.listing_date);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const b = buckets.get(key) || { mb: 0, sme: 0 };
      if (isSme(i)) b.sme++;
      else b.mb++;
      buckets.set(key, b);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => {
        const [y, m] = key.split('-');
        return {
          key,
          label: `${MONTHS[Number(m) - 1][0]}${m === '01' ? `'${y.slice(2)}` : ''}`,
          segments: [
            { key: 'mb', label: 'Mainboard', value: b.mb, color: MUN.violet },
            { key: 'sme', label: 'SME', value: b.sme, color: MUN.cyan },
          ],
        };
      });
  }, [ipos]);

  // ---- chart 2: fresh vs OFS by calendar year ----
  const byYear = useMemo(() => {
    const m = new Map<number, { fresh: number; ofs: number }>();
    for (const i of ipos) {
      if (!i.listing_date) continue;
      const y = new Date(i.listing_date).getUTCFullYear();
      const b = m.get(y) || { fresh: 0, ofs: 0 };
      b.fresh += i.fresh_cr || 0;
      b.ofs += i.ofs_cr || 0;
      m.set(y, b);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([y, b]) => ({ y, ...b, total: b.fresh + b.ofs }));
  }, [ipos]);

  // ---- chart 3: wealth created by sector ----
  const sectorDonut: DonutDatum[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ipos) {
      const w = i.company_promoter_wealth_cr || 0;
      if (w <= 0) continue;
      const s = i.sector || 'Unclassified';
      m.set(s, (m.get(s) || 0) + w);
    }
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const TOP = 11;
    const top = sorted.slice(0, TOP);
    const restCr = sorted.slice(TOP).reduce((s, [, v]) => s + v, 0);
    const out = top.map(([sector, cr]) => ({ key: sector, label: sector, value: Math.round(cr), color: sectorColor(sector) }));
    if (restCr > 0) out.push({ key: 'other', label: `Other sectors (${sorted.length - TOP})`, value: Math.round(restCr), color: '#CBD5E1' });
    return out;
  }, [ipos]);
  const sectorTotal = sectorDonut.reduce((s, d) => s + d.value, 0);

  const totalIssue = ipos.reduce((s, i) => s + (i.issue_size_cr || 0), 0);
  const totalOfs = ipos.reduce((s, i) => s + (i.ofs_cr || 0), 0);

  const columns: Column<IPO>[] = useMemo(
    () => [
      { key: 'company', header: 'Company', sortable: true, sortValue: (i) => i.company, render: (i) => <span className="font-semibold text-mun-ink">{companyShort(i.company)}</span> },
      { key: 'exch', header: 'Board', align: 'center', sortable: true, sortValue: (i) => i.exchange, render: (i) => <Badge color={exchColor(i.exchange)}>{i.exchange}</Badge> },
      { key: 'listing', header: 'Listed', sortable: true, sortValue: (i) => (i.listing_date ? Date.parse(i.listing_date) : 0), render: (i) => <span className="tnum text-mun-slate">{dateLabel(i.listing_date)}</span> },
      { key: 'price', header: 'Price', align: 'right', sortable: true, sortValue: (i) => i.issue_price_high ?? 0, render: (i) => <span className="tnum text-mun-slate">{i.issue_price_low ? `₹${num(i.issue_price_low)}${i.issue_price_high && i.issue_price_high !== i.issue_price_low ? `–${num(i.issue_price_high)}` : ''}` : '—'}</span> },
      { key: 'size', header: 'Issue size', align: 'right', sortable: true, sortValue: (i) => i.issue_size_cr ?? 0, render: (i) => <span className="tnum font-semibold text-mun-ink">{fmtCr(i.issue_size_cr)}</span> },
      { key: 'split', header: 'Fresh / OFS', render: (i) => <SplitBar fresh={i.fresh_cr} ofs={i.ofs_cr} /> },
      {
        key: 'promoter',
        header: 'Promoter group',
        render: (i) => {
          const lead = leadPromoter(i);
          const nP = (i.promoters || []).filter((p) => p.is_promoter).length;
          return lead ? (
            <span className="text-mun-slate">
              {lead}
              {nP > 1 && <span className="text-mun-grey"> +{nP - 1}</span>}
            </span>
          ) : (
            <span className="text-mun-grey">—</span>
          );
        },
      },
      { key: 'post', header: 'Post %', align: 'right', sortable: true, sortValue: (i) => i.post_promoter_pct ?? -1, render: (i) => <span className="tnum">{pct(i.post_promoter_pct)}</span> },
      { key: 'hold', header: 'Holding value', align: 'right', sortable: true, sortValue: (i) => i.holding_value_cr ?? -1, render: (i) => <span className="tnum" style={{ color: MONEY.holdingDark }}>{fmtCr(i.holding_value_cr)}</span> },
      { key: 'ofs', header: 'OFS cash', align: 'right', sortable: true, sortValue: (i) => i.promoter_ofs_cash_cr ?? -1, render: (i) => <span className="tnum" style={{ color: MONEY.ofsDark }}>{fmtCr(i.promoter_ofs_cash_cr)}</span> },
    ],
    [],
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        icon={Rocket}
        title="IPO Explorer"
        subtitle="The evidence layer — every liquidity event we mine, with the fresh-vs-cashout split and promoter trail."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <SubTabs
              active={seg}
              onChange={(v) => setSeg(v as Seg)}
              tabs={[
                { key: 'all', label: 'All', color: MUN.primary },
                { key: 'mb', label: 'Mainboard', color: MUN.violet },
                { key: 'sme', label: 'SME', color: MUN.cyan },
              ]}
            />
            <Dropdown value={year} options={yearOpts} onChange={setYear} width={130} />
            <label className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 shadow-sm">
              <Search size={14} className="text-mun-grey" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company" className="w-36 bg-transparent text-[13px] text-mun-ink outline-none placeholder:text-mun-grey" />
              {q && <button onClick={() => setQ('')} className="text-mun-grey hover:text-mun-slate"><X size={13} /></button>}
            </label>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="IPOs in view" value={num(ipos.length)} sub={seg === 'all' ? 'mainboard + SME' : seg === 'mb' ? 'mainboard' : 'SME'} color={MUN.primary} />
        <MiniStat label="Capital raised" value={fmtCr(totalIssue)} sub="total issue size" color={MUN.violet} />
        <MiniStat label="Cashed out (OFS)" value={fmtCr(totalOfs)} sub="promoters + sellers" color={MONEY.ofs} />
        <MiniStat label="Wealth mapped" value={fmtCr(sectorTotal)} sub="promoter wealth by sector" color={MUN.emerald} />
      </div>

      {/* chart 1: timeline */}
      <Card className="mb-4">
        <CardHeader
          icon={Factory}
          title="IPOs per month"
          subtitle="The listing timeline — hover a column for the mainboard / SME split"
          accent={MUN.primary}
          right={
            <div className="flex items-center gap-3 text-[11px] text-mun-grey">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: MUN.violet }} /> Mainboard</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: MUN.cyan }} /> SME</span>
            </div>
          }
        />
        {timeline.length ? <StackedColumns data={timeline} format={(n) => num(n)} height={240} /> : <Empty />}
      </Card>

      {/* charts 2 + 3 */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={Scale}
            title="Fresh capital vs cash-out, by year"
            subtitle="How much went to the company vs to promoters selling"
            accent={MONEY.ofs}
            right={
              <div className="flex items-center gap-3 text-[11px] text-mun-grey">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: MUN.primary }} /> Fresh</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: MONEY.ofs }} /> OFS</span>
              </div>
            }
          />
          <div className="space-y-3">
            {byYear.length ? (
              byYear.map((b) => (
                <div key={b.y} className="flex items-center gap-3">
                  <span className="tnum w-12 shrink-0 text-[12px] font-bold text-mun-slate">{b.y}</span>
                  <div className="min-w-0 flex-1">
                    <StackedBar
                      segments={[
                        { key: 'fresh', label: 'Fresh capital', value: Math.round(b.fresh), color: MUN.primary },
                        { key: 'ofs', label: 'Offer-for-Sale', value: Math.round(b.ofs), color: MONEY.ofs },
                      ]}
                      format={(n) => fmtCr(n)}
                      height={26}
                    />
                  </div>
                  <span className="tnum w-20 shrink-0 text-right text-[12px] font-semibold text-mun-ink">{fmtCr(b.total)}</span>
                </div>
              ))
            ) : (
              <Empty />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader icon={PieChart} title="Wealth created, by sector" subtitle="Sum of promoter wealth across each sector's IPOs" accent={MUN.emerald} />
          {sectorDonut.length ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Donut data={sectorDonut} format={(n) => fmtCr(n)} height={226} centerTitle="Total" centerValue={fmtCr(sectorTotal)} thickness={28} />
              </div>
              <div className="w-[44%] space-y-1">
                {sectorDonut.slice(0, 7).map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-mun-slate">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                      <span className="truncate">{d.label}</span>
                    </span>
                    <span className="tnum shrink-0 font-semibold text-mun-ink">{fmtCr(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty />
          )}
        </Card>
      </div>

      {/* table */}
      <Card pad={false}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-mun-ink">
            <Rocket size={15} className="text-mun-primary" /> {num(ipos.length)} IPOs
          </h3>
          {focusCompany ? (
            <button
              onClick={() => {
                setQ('');
                onClearFocus?.();
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-mun-primary/10 px-2.5 py-1 text-[11px] font-semibold text-mun-primary transition hover:bg-mun-primary/20"
            >
              Focused: {companyShort(focusCompany)} <X size={12} />
            </button>
          ) : (
            <span className="text-[11px] text-mun-grey">Click a row → the lead promoter's 360</span>
          )}
        </div>
        <Table
          columns={columns}
          rows={ipos}
          getKey={(i) => i.id}
          initialSort={{ key: 'listing', dir: 'desc' }}
          onRowClick={(i) => {
            const lead = leadPromoter(i);
            if (lead) onOpenPromoter(lead);
          }}
          activeKey={focusId}
          maxHeight={600}
          dense
        />
      </Card>
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-[12.5px] text-mun-grey">No IPOs match these filters.</p>;
}
