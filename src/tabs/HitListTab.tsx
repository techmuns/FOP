import { useMemo, useState } from 'react';
import { Target, Banknote, Activity, Download, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import type { AppData, Prospect, Exchange } from '../types';
import { PageHeader, Card, CardHeader, MiniStat, Badge } from '../components/ui/Card';
import { Segmented, Dropdown, Toggle, Slider, type Option } from '../components/ui/Controls';
import { Table, type Column } from '../components/ui/Table';
import { HBars, type HBarDatum } from '../components/charts/Bars';
import { fmtCr, pct, num } from '../lib/format';
import { wealthBandColor, WEALTH_BANDS, MONEY, CONFIDENCE_COLOR, sectorColor, MUN } from '../lib/brand';
import { downloadXlsx, stamp } from '../lib/export';

const PRESETS = [50, 100, 150, 250, 500];
type ExchFilter = 'all' | 'NSE' | 'BSE' | 'SME';

const exchCat = (e: Exchange): ExchFilter => (String(e).includes('SME') ? 'SME' : e === 'BSE' ? 'BSE' : 'NSE');
const companyShort = (s: string) => s.replace(/\s+(Ltd\.?|Limited)\.?$/i, '').trim();
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function HitListTab({ data, onOpenPromoter }: { data: AppData; onOpenPromoter: (person: string) => void }) {
  const [threshold, setThreshold] = useState(150);
  const [exch, setExch] = useState<ExchFilter>('all');
  const [sector, setSector] = useState('all');
  const [stateF, setStateF] = useState('all');
  const [year, setYear] = useState('all');
  const [tookOfs, setTookOfs] = useState(false);
  const [highConf, setHighConf] = useState(false);
  const [q, setQ] = useState('');

  // ---- filter option lists ----
  const { sectorOpts, stateOpts, yearOpts } = useMemo(() => {
    const secs = new Set<string>();
    const sts = new Set<string>();
    const yrs = new Set<string>();
    for (const p of data.prospects) {
      p.sectors.forEach((s) => s && secs.add(s));
      if (p.state) sts.add(p.state);
      for (const c of p.companies) if (c.listing_date) yrs.add(String(new Date(c.listing_date).getUTCFullYear()));
    }
    const opt = (v: string) => ({ value: v, label: v });
    return {
      sectorOpts: [{ value: 'all', label: 'All sectors' }, ...[...secs].sort().map(opt)] as Option[],
      stateOpts: [{ value: 'all', label: 'All states' }, ...[...sts].sort().map(opt)] as Option[],
      yearOpts: [{ value: 'all', label: 'All years' }, ...[...yrs].sort((a, b) => Number(b) - Number(a)).map(opt)] as Option[],
    };
  }, [data.prospects]);

  // ---- apply filters ----
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.prospects.filter((p) => {
      if (p.est_wealth_cr < threshold) return false;
      if (exch !== 'all' && !p.companies.some((c) => exchCat(c.exchange) === exch)) return false;
      if (sector !== 'all' && !p.sectors.includes(sector)) return false;
      if (stateF !== 'all' && p.state !== stateF) return false;
      if (year !== 'all' && !p.companies.some((c) => c.listing_date && String(new Date(c.listing_date).getUTCFullYear()) === year)) return false;
      if (tookOfs && p.ofs_cash_cr <= 0) return false;
      if (highConf && p.confidence !== 'HIGH') return false;
      if (needle && !p.person.toLowerCase().includes(needle) && !p.companies.some((c) => c.company.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data.prospects, threshold, exch, sector, stateF, year, tookOfs, highConf, q]);

  const stats = useMemo(() => {
    const totalWealth = filtered.reduce((s, p) => s + p.est_wealth_cr, 0);
    const totalOfs = filtered.reduce((s, p) => s + p.ofs_cash_cr, 0);
    return { count: filtered.length, totalWealth, totalOfs, med: median(filtered.map((p) => p.est_wealth_cr)) };
  }, [filtered]);

  const topBars: HBarDatum[] = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => b.est_wealth_cr - a.est_wealth_cr)
        .slice(0, 20)
        .map((p) => {
          const top = [...p.companies].sort((a, b) => (b.ofs_cash_cr || 0) + (b.holding_value_cr || 0) - ((a.ofs_cash_cr || 0) + (a.holding_value_cr || 0)))[0];
          return {
            key: p.person,
            label: p.person,
            value: p.est_wealth_cr,
            color: wealthBandColor(p.est_wealth_cr),
            valueLabel: fmtCr(p.est_wealth_cr),
            sublabel: [p.city, p.state].filter(Boolean).join(', ') || p.sectors.slice(0, 2).join(', '),
            tipRows: [
              { label: 'Still held', value: fmtCr(p.holding_value_cr), color: MONEY.holding },
              { label: 'Cash out (OFS)', value: fmtCr(p.ofs_cash_cr), color: MONEY.ofs },
              { label: 'Top company', value: top ? companyShort(top.company) : '—', color: MUN.primary },
              { label: 'Confidence', value: p.confidence, color: CONFIDENCE_COLOR[p.confidence] },
            ],
            note: `${p.companies.length} IPO${p.companies.length > 1 ? 's' : ''}${p.sectors.length ? ' · ' + p.sectors.slice(0, 2).join(', ') : ''}`,
          };
        }),
    [filtered],
  );

  const columns: Column<Prospect>[] = useMemo(
    () => [
      {
        key: 'person',
        header: 'Person',
        sortable: true,
        sortValue: (p) => p.person,
        render: (p) => (
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: wealthBandColor(p.est_wealth_cr) }}>
              {p.person.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <span className="font-semibold text-mun-ink">{p.person}</span>
          </div>
        ),
      },
      {
        key: 'companies',
        header: 'Companies',
        render: (p) => (
          <div className="flex flex-wrap gap-1">
            {p.companies.slice(0, 2).map((c, i) => (
              <span key={i} className="rounded-md bg-mun-offwhite px-1.5 py-0.5 text-[10.5px] font-medium text-mun-slate">
                {companyShort(c.company)}
              </span>
            ))}
            {p.companies.length > 2 && <span className="text-[10.5px] font-medium text-mun-grey">+{p.companies.length - 2}</span>}
          </div>
        ),
      },
      {
        key: 'wealth',
        header: 'Est. wealth',
        align: 'right',
        sortable: true,
        sortValue: (p) => p.est_wealth_cr,
        render: (p) => (
          <span className="tnum inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: `${wealthBandColor(p.est_wealth_cr)}1a`, color: wealthBandColor(p.est_wealth_cr) }}>
            {fmtCr(p.est_wealth_cr)}
          </span>
        ),
      },
      { key: 'ofs', header: 'Cash out (OFS)', align: 'right', sortable: true, sortValue: (p) => p.ofs_cash_cr, render: (p) => <span className="tnum font-semibold" style={{ color: MONEY.ofsDark }}>{fmtCr(p.ofs_cash_cr)}</span> },
      { key: 'holding', header: 'Holding value', align: 'right', sortable: true, sortValue: (p) => p.holding_value_cr, render: (p) => <span className="tnum" style={{ color: MONEY.holdingDark }}>{fmtCr(p.holding_value_cr)}</span> },
      { key: 'geo', header: 'City / State', sortable: true, sortValue: (p) => p.state || 'zz', render: (p) => <span className="text-mun-slate">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</span> },
      {
        key: 'sector',
        header: 'Sector',
        render: (p) =>
          p.sectors.length ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-mun-slate">
              <span className="h-2 w-2 rounded-sm" style={{ background: sectorColor(p.sectors[0]) }} />
              {p.sectors[0]}
              {p.sectors.length > 1 && <span className="text-mun-grey">+{p.sectors.length - 1}</span>}
            </span>
          ) : (
            <span className="text-mun-grey">—</span>
          ),
      },
      {
        key: 'pledge',
        header: 'Pledge %',
        align: 'right',
        sortable: true,
        sortValue: (p) => p.max_pledge_pct ?? -1,
        heat: (p) => (p.max_pledge_pct != null ? Math.min(1, p.max_pledge_pct / 50) : null),
        heatColor: MONEY.pledge,
        heatScale: 'hue',
        render: (p) => <span className="tnum">{p.max_pledge_pct != null ? pct(p.max_pledge_pct) : '—'}</span>,
      },
      {
        key: 'conf',
        header: 'Confidence',
        align: 'center',
        sortable: true,
        sortValue: (p) => ({ HIGH: 3, MEDIUM: 2, LOW: 1 })[p.confidence],
        render: (p) => <Badge color={CONFIDENCE_COLOR[p.confidence]}>{p.confidence}</Badge>,
      },
    ],
    [],
  );

  function doExport() {
    const rows = filtered.map((p) => ({
      Person: p.person,
      Companies: p.companies.map((c) => companyShort(c.company)).join('; '),
      'Est. wealth (Cr)': Math.round(p.est_wealth_cr),
      'Cash out OFS (Cr)': Math.round(p.ofs_cash_cr),
      'Holding value (Cr)': Math.round(p.holding_value_cr),
      City: p.city || '',
      State: p.state || '',
      Sectors: p.sectors.join('; '),
      'Max pledge %': p.max_pledge_pct ?? '',
      Confidence: p.confidence,
      'Latest listing': p.latest_listing_date || '',
      'Qualifies >=150Cr': p.qualifies ? 'Yes' : 'No',
    }));
    void downloadXlsx(rows, `munshot-hitlist-${threshold}cr-${stamp()}.xlsx`, {
      sheetName: 'Hit-List',
      colWidths: [26, 40, 15, 16, 16, 16, 16, 28, 12, 11, 14, 16],
    }).catch(() => {});
  }

  const anyFilter = exch !== 'all' || sector !== 'all' || stateF !== 'all' || year !== 'all' || tookOfs || highConf || q.trim() !== '';

  return (
    <div className="animate-fade-up">
      <PageHeader
        icon={Target}
        title="Hit-List"
        subtitle="The money screen — every freshly-wealthy promoter, ranked. Drag the threshold; everything reacts."
        right={
          <button onClick={doExport} className="inline-flex items-center gap-1.5 rounded-lg bg-mun-primary px-3 py-2 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-mun-primary-deep">
            <Download size={15} /> Export to Excel
          </button>
        }
      />

      {/* 1. Threshold control */}
      <Card className="mb-4" pad>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="shrink-0">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-mun-grey">
              <SlidersHorizontal size={14} className="text-mun-primary" /> Show me people worth at least
            </div>
            <div className="tnum font-display text-[30px] font-extrabold leading-none text-mun-primary">{fmtCr(threshold)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <Slider value={threshold} min={25} max={1000} step={25} onChange={setThreshold} ariaLabel="Minimum estimated wealth in crore" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setThreshold(v)}
                  className={`tnum rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                    threshold === v ? 'border-transparent bg-mun-primary text-white shadow-sm' : 'border-black/10 bg-white text-mun-slate hover:border-mun-primary/40'
                  }`}
                >
                  ₹{v} Cr{v === 150 ? ' ·default' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Stat tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Qualifying people" value={num(stats.count)} sub={`worth ≥ ${fmtCr(threshold)}`} color={MUN.primary} />
        <MiniStat label="Total est. wealth" value={fmtCr(stats.totalWealth)} sub="combined, in view" color={MUN.primary} />
        <MiniStat label="Cash out (OFS)" value={fmtCr(stats.totalOfs)} sub="already taken out" color={MONEY.ofs} />
        <MiniStat label="Median wealth" value={fmtCr(stats.med)} sub="typical person in view" color={MUN.emerald} />
      </div>

      {/* 3. Hero chart */}
      <Card className="mb-4">
        <CardHeader icon={Banknote} title={`Top ${Math.min(20, topBars.length)} by estimated wealth`} subtitle="Hover any bar for the holding-vs-cash split and their top company" accent={MUN.primary} />
        {topBars.length ? (
          <HBars data={topBars} format={(n) => fmtCr(n)} labelWidth={170} barSize={20} />
        ) : (
          <Empty threshold={threshold} />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/[0.05] pt-2 text-[11px] text-mun-grey">
          <span className="font-medium">Wealth band:</span>
          {WEALTH_BANDS.map((b) => (
            <span key={b.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      </Card>

      {/* 4. Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={exch}
          onChange={(v) => setExch(v as ExchFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'NSE', label: 'NSE' },
            { value: 'BSE', label: 'BSE' },
            { value: 'SME', label: 'SME' },
          ]}
        />
        <Dropdown value={sector} options={sectorOpts} onChange={setSector} width={190} />
        <Dropdown value={stateF} options={stateOpts} onChange={setStateF} width={160} />
        <Dropdown value={year} options={yearOpts} onChange={setYear} width={130} />
        <label className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 shadow-sm">
          <Search size={14} className="text-mun-grey" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / company" className="w-40 bg-transparent text-[13px] text-mun-ink outline-none placeholder:text-mun-grey" />
          {q && <button onClick={() => setQ('')} className="text-mun-grey hover:text-mun-slate"><X size={13} /></button>}
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 shadow-sm">
          <Toggle checked={tookOfs} onChange={setTookOfs} label="Took cash out" color={MONEY.ofs} />
          <span className="h-4 w-px bg-mun-light" />
          <Toggle checked={highConf} onChange={setHighConf} label="High-confidence" color={MUN.emerald} />
        </div>
      </div>

      {/* 5. Table */}
      <Card pad={false}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-mun-ink">
            <Users size={15} className="text-mun-primary" /> {num(filtered.length)} people
            {anyFilter && <span className="text-[11px] font-medium text-mun-grey">· filtered from {num(data.prospects.length)}</span>}
          </h3>
          <span className="text-[11px] text-mun-grey">Click a row → Promoter 360</span>
        </div>
        <Table
          columns={columns}
          rows={filtered}
          getKey={(p) => p.person}
          initialSort={{ key: 'ofs', dir: 'desc' }}
          onRowClick={(p) => onOpenPromoter(p.person)}
          maxHeight={560}
          dense
        />
      </Card>
    </div>
  );
}

function Empty({ threshold }: { threshold: number }) {
  return (
    <div className="grid place-items-center gap-2 py-12 text-center">
      <Activity size={22} className="text-mun-light" />
      <p className="max-w-sm text-[12.5px] text-mun-grey">No one in view at ≥ {fmtCr(threshold)}. Lower the threshold or clear a filter.</p>
    </div>
  );
}
