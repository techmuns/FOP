import { useMemo } from 'react';
import {
  UserSearch, ArrowLeft, Building2, MapPin, PieChart, Layers, Download, Clock, Network,
  ShieldCheck, Target, Wallet,
} from 'lucide-react';
import type { AppData, Prospect, IPO } from '../types';
import { PageHeader, Card, CardHeader, MiniStat, Badge } from '../components/ui/Card';
import { StackedBar } from '../components/charts/StackedBar';
import { Donut, type DonutDatum } from '../components/charts/Donut';
import { HBars, type HBarDatum } from '../components/charts/Bars';
import { Timeline, type TimelineEvent } from '../components/charts/Timeline';
import { fmtCr, pct, num, dateLabel } from '../lib/format';
import { normalizeName, prospectsByBand, sectorTotals, summary } from '../lib/wealth';
import { MONEY, CONFIDENCE_COLOR, sectorColor, MUN, wealthBandColor } from '../lib/brand';
import { downloadXlsx, stamp } from '../lib/export';

const companyShort = (s: string) => s.replace(/\s+(Ltd\.?|Limited)\.?$/i, '').trim();
const exchColor = (e: string) => (e === 'NSE' ? MUN.primary : e === 'BSE' ? MUN.violet : e.includes('BSE') ? MUN.amber : MUN.cyan);

export function Promoter360Tab({
  data,
  focusPerson,
  onClearFocus,
  onOpenPromoter,
  onOpenIpo,
}: {
  data: AppData;
  focusPerson?: string | null;
  onClearFocus?: () => void;
  onOpenPromoter?: (person: string) => void;
  onOpenIpo?: (company: string) => void;
}) {
  const focusKey = focusPerson ? normalizeName(focusPerson).key : null;
  const person = focusKey ? data.prospects.find((p) => normalizeName(p.person).key === focusKey) : null;

  if (focusPerson && person) {
    return <PersonProfile person={person} data={data} onBack={onClearFocus} onOpenPromoter={onOpenPromoter} onOpenIpo={onOpenIpo} />;
  }
  if (focusPerson && !person) {
    return <NotFound name={focusPerson} onBack={onClearFocus} />;
  }
  return <Overview data={data} />;
}

// ---------------------------------------------------------------- person profile

function PersonProfile({
  person,
  data,
  onBack,
  onOpenPromoter,
  onOpenIpo,
}: {
  person: Prospect;
  data: AppData;
  onBack?: () => void;
  onOpenPromoter?: (person: string) => void;
  onOpenIpo?: (company: string) => void;
}) {
  const ipoByCompany = useMemo(() => new Map<string, IPO>(data.ipos.map((i) => [i.company, i])), [data.ipos]);
  const bandColor = wealthBandColor(person.est_wealth_cr);

  const breakdown = [
    { key: 'hold', label: 'Still held (listed equity)', value: Math.round(person.holding_value_cr), color: MONEY.holding },
    { key: 'ofs', label: 'Cash taken out (OFS)', value: Math.round(person.ofs_cash_cr), color: MONEY.ofs },
  ].filter((s) => s.value > 0);

  const sectorMix: DonutDatum[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of person.companies) {
      const w = (c.holding_value_cr || 0) + (c.ofs_cash_cr || 0);
      if (w <= 0) continue;
      const s = c.sector || 'Other';
      m.set(s, (m.get(s) || 0) + w);
    }
    return [...m.entries()].map(([sector, cr]) => ({ key: sector, label: sector, value: Math.round(cr), color: sectorColor(sector) })).sort((a, b) => b.value - a.value);
  }, [person]);

  const timeline: TimelineEvent[] = useMemo(
    () =>
      person.companies
        .filter((c) => c.listing_date)
        .map((c) => ({
          key: c.company,
          date: c.listing_date as string,
          label: companyShort(c.company),
          value: fmtCr((c.ofs_cash_cr || 0) > 0 ? c.ofs_cash_cr : c.holding_value_cr),
          color: sectorColor(c.sector || ''),
          tipRows: [
            { label: 'Listed', value: dateLabel(c.listing_date) },
            { label: 'Cash out', value: fmtCr(c.ofs_cash_cr), color: MONEY.ofs },
            { label: 'Still held', value: fmtCr(c.holding_value_cr), color: MONEY.holding },
          ],
        })),
    [person],
  );

  const coPromoters = useMemo(() => {
    const seen = new Map<string, { name: string; company: string }>();
    const selfKey = normalizeName(person.person).key;
    for (const c of person.companies) {
      const ipo = ipoByCompany.get(c.company);
      if (!ipo) continue;
      for (const pr of ipo.promoters || []) {
        if (!pr.is_promoter) continue;
        const k = normalizeName(pr.name).key;
        if (k === selfKey || seen.has(k)) continue;
        seen.set(k, { name: normalizeName(pr.name).display, company: companyShort(c.company) });
      }
    }
    return [...seen.values()];
  }, [person, ipoByCompany]);

  const summaryLine = `Cashed out ${fmtCr(person.ofs_cash_cr)} across ${person.companies.length} IPO${person.companies.length > 1 ? 's' : ''}; still holds ${fmtCr(person.holding_value_cr)} in listed equity${person.state ? `; based in ${[person.city, person.state].filter(Boolean).join(', ')}` : ''}.`;

  function exportProfile() {
    const rows = person.companies.map((c) => {
      const ipo = ipoByCompany.get(c.company);
      return {
        Company: companyShort(c.company),
        Board: c.exchange,
        Listed: c.listing_date || '',
        Role: c.role,
        'Pre %': ipo?.pre_promoter_pct ?? '',
        'Post %': ipo?.post_promoter_pct ?? '',
        'Current %': ipo?.current_promoter_pct ?? '',
        'Holding value (Cr)': c.holding_value_cr != null ? Math.round(c.holding_value_cr) : '',
        'Cash out OFS (Cr)': c.ofs_cash_cr != null ? Math.round(c.ofs_cash_cr) : '',
        Sector: c.sector || '',
        'Pledge %': ipo?.pledge_pct ?? '',
      };
    });
    void downloadXlsx(rows, `munshot-${person.person.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${stamp()}.xlsx`, {
      sheetName: 'Profile',
      colWidths: [30, 9, 12, 14, 8, 8, 10, 18, 18, 24, 10],
    }).catch(() => {});
  }

  return (
    <div className="animate-fade-up">
      {/* back control */}
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-mun-slate shadow-sm transition hover:border-mun-primary/40 hover:text-mun-primary">
        <ArrowLeft size={15} /> Back to all promoters
      </button>

      {/* 1. identity header */}
      <Card className="mb-4 overflow-hidden" pad={false}>
        <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${bandColor}, ${MONEY.ofs})` }} />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-[16px] font-extrabold text-white shadow-sm" style={{ background: bandColor }}>
              {person.person.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[22px] font-extrabold leading-tight text-mun-ink">{person.person}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mun-grey">
                <Badge color={CONFIDENCE_COLOR[person.confidence]}>{person.confidence} confidence</Badge>
                {(person.city || person.state) && (
                  <span className="inline-flex items-center gap-1"><MapPin size={13} /> {[person.city, person.state].filter(Boolean).join(', ')}</span>
                )}
                <span className="inline-flex items-center gap-1"><Building2 size={13} /> {person.companies.length} {person.companies.length > 1 ? 'companies' : 'company'}</span>
                <span className="inline-flex items-center gap-1"><Clock size={13} /> latest {dateLabel(person.latest_listing_date)}</span>
              </div>
              <p className="mt-2 max-w-2xl text-[13px] leading-snug text-mun-slate">{summaryLine}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-mun-grey">Est. wealth</div>
            <div className="tnum font-display text-[30px] font-extrabold leading-none" style={{ color: bandColor }}>{fmtCr(person.est_wealth_cr)}</div>
            <button onClick={exportProfile} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-mun-primary px-2.5 py-1.5 text-[11.5px] font-bold text-white shadow-sm transition hover:bg-mun-primary-deep">
              <Download size={13} /> Export profile
            </button>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* 2. wealth breakdown */}
        <Card>
          <CardHeader icon={Wallet} title="Wealth breakdown" subtitle="Paper wealth still held + cash already taken out = total estimate" accent={MUN.primary} />
          {breakdown.length ? (
            <>
              <StackedBar segments={breakdown} format={(n) => fmtCr(n)} height={48} />
              <div className="mt-3 space-y-1.5">
                {breakdown.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-1.5 text-mun-slate"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}</span>
                    <span className="tnum font-semibold text-mun-ink">{fmtCr(s.value)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-black/[0.06] pt-1.5 text-[13px]">
                  <span className="font-bold text-mun-ink">Total estimated wealth</span>
                  <span className="tnum font-extrabold" style={{ color: bandColor }}>{fmtCr(person.est_wealth_cr)}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[12.5px] text-mun-grey">No wealth split available.</p>
          )}
        </Card>

        {/* 4. sector mix */}
        <Card>
          <CardHeader icon={PieChart} title="Wealth by sector" subtitle="Where this person's wealth sits" accent={MUN.violet} />
          {sectorMix.length ? (
            <Donut data={sectorMix} format={(n) => fmtCr(n)} height={210} centerTitle="Total" centerValue={fmtCr(person.est_wealth_cr)} thickness={26} />
          ) : (
            <p className="py-8 text-center text-[12.5px] text-mun-grey">No sector data.</p>
          )}
        </Card>
      </div>

      {/* 3. companies */}
      <Card className="mt-4">
        <CardHeader icon={Building2} title="Companies" subtitle="Click a card to jump to that IPO in the Explorer" accent={MUN.emerald} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {person.companies
            .slice()
            .sort((a, b) => (b.holding_value_cr || 0) + (b.ofs_cash_cr || 0) - ((a.holding_value_cr || 0) + (a.ofs_cash_cr || 0)))
            .map((c) => {
              const ipo = ipoByCompany.get(c.company);
              return (
                <button
                  key={c.company}
                  onClick={() => onOpenIpo?.(c.company)}
                  className="group rounded-xl border border-black/[0.07] bg-white p-3 text-left shadow-sm transition hover:border-mun-primary/40 hover:shadow-card-hover"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-bold leading-tight text-mun-ink group-hover:text-mun-primary">{companyShort(c.company)}</span>
                    <Badge color={exchColor(c.exchange)}>{c.exchange}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-mun-grey">{c.sector || '—'} · listed {dateLabel(c.listing_date)}</div>
                  <div className="mt-2 flex items-center gap-1 text-[11.5px]">
                    <span className="text-mun-grey">Holding %</span>
                    <span className="tnum font-semibold text-mun-slate">{pct(ipo?.pre_promoter_pct)}</span>
                    <span className="text-mun-light">→</span>
                    <span className="tnum font-semibold text-mun-slate">{pct(ipo?.post_promoter_pct)}</span>
                    <span className="text-mun-light">→</span>
                    <span className="tnum font-bold text-mun-primary">{pct(ipo?.current_promoter_pct ?? ipo?.post_promoter_pct)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 border-t border-black/[0.05] pt-2 text-center">
                    <Metric label="Held" value={fmtCr(c.holding_value_cr)} color={MONEY.holdingDark} />
                    <Metric label="Cash out" value={fmtCr(c.ofs_cash_cr)} color={MONEY.ofsDark} />
                    <Metric label="Pledge" value={ipo?.pledge_pct != null ? pct(ipo.pledge_pct) : '—'} color={ipo?.pledge_pct ? MONEY.pledge : '#94A3B8'} />
                  </div>
                </button>
              );
            })}
        </div>
      </Card>

      {/* 5. liquidity timeline */}
      <Card className="mt-4">
        <CardHeader icon={Clock} title="Liquidity timeline" subtitle="When the cash landed — each IPO on the date it listed" accent={MUN.amber} />
        <Timeline events={timeline} height={140} />
      </Card>

      {/* 6. connected promoters */}
      {coPromoters.length > 0 && (
        <Card className="mt-4">
          <CardHeader icon={Network} title="Circle of influence" subtitle={`${coPromoters.length} co-promoter${coPromoters.length > 1 ? 's' : ''} who appear alongside ${person.person.split(' ')[0]} in the same IPOs`} accent={MUN.cyan} />
          <div className="flex flex-wrap gap-2">
            {coPromoters.map((cp) => (
              <button
                key={cp.name}
                onClick={() => onOpenPromoter?.(cp.name)}
                className="inline-flex items-center gap-1.5 rounded-full border border-mun-cyan/30 bg-mun-cyan/[0.06] px-3 py-1.5 text-[12px] font-semibold text-mun-slate transition hover:border-mun-cyan hover:bg-mun-cyan/10"
                title={`Co-promoter at ${cp.company} — open their 360`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-mun-cyan/20 text-[8px] font-bold text-mun-cyan">
                  {cp.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                {cp.name}
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="tnum text-[12px] font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-mun-grey">{label}</div>
    </div>
  );
}

function NotFound({ name, onBack }: { name: string; onBack?: () => void }) {
  return (
    <div className="animate-fade-up">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-mun-slate shadow-sm hover:text-mun-primary">
        <ArrowLeft size={15} /> Back to all promoters
      </button>
      <Card>
        <div className="grid place-items-center gap-2 py-10 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-mun-offwhite text-mun-grey"><UserSearch size={22} /></span>
          <h3 className="font-display text-[16px] font-bold text-mun-ink">{name}</h3>
          <p className="max-w-sm text-[12.5px] text-mun-grey">This promoter sits below the ₹25 Cr floor, so there's no full profile — they were a minor seller in an IPO. Lower-value sellers aren't tracked as prospects.</p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- overview index

function Overview({ data }: { data: AppData }) {
  const prospects = data.prospects.filter((p) => p.qualifies);
  const s = summary(prospects);
  const bands = prospectsByBand(prospects).filter((b) => b.count > 0);
  const donut: DonutDatum[] = bands.map((b) => ({ key: b.key, label: b.label, value: b.totalCr, color: b.color }));
  const sectorBars: HBarDatum[] = sectorTotals(prospects).slice(0, 7).map((x) => ({ key: x.sector, label: x.sector, value: x.cr, color: sectorColor(x.sector), valueLabel: fmtCr(x.cr) }));
  const withHoldings = prospects.filter((p) => p.holding_value_cr > 0).length;
  const highConf = prospects.filter((p) => p.confidence === 'HIGH').length;
  const states = [...new Set(prospects.map((p) => p.state).filter(Boolean))];
  const confCounts = (['HIGH', 'MEDIUM', 'LOW'] as const).map((c) => ({ c, n: prospects.filter((p) => p.confidence === c).length }));

  return (
    <div className="animate-fade-up">
      <PageHeader icon={UserSearch} title="Promoter 360" subtitle={`${num(data.meta.counts.prospects)} promoters de-anonymised from IPO disclosures — click any person in the Hit-List or IPO Explorer to open their 360° profile`} />

      <div className="mb-4 rounded-2xl border border-dashed border-mun-primary/30 bg-mun-primary/[0.04] px-4 py-2.5 text-[12.5px] text-mun-slate">
        <span className="font-semibold text-mun-primary">Tip:</span> every name in the Hit-List and every IPO row opens a full drill-down here — wealth split, companies, sector mix, liquidity timeline, and the promoter's circle of influence.
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="People tracked" value={num(prospects.length)} sub="qualifying ≥ ₹150 Cr" color={MUN.primary} />
        <MiniStat label="With holdings" value={num(withHoldings)} sub="paper wealth valued" color={MUN.emerald} />
        <MiniStat label="High confidence" value={num(highConf)} sub="single promoter / exact OFS" color={MUN.emerald} />
        <MiniStat label="States covered" value={num(states.length)} sub="by registered office" color={MUN.cyan} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={Target} title="Wealth by band" subtitle="How the money splits across the three target tiers" accent={MUN.violet} />
          {donut.length ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><Donut data={donut} format={(n) => fmtCr(n)} height={220} centerTitle="In view" centerValue={fmtCr(s.totalWealthCr)} thickness={30} /></div>
              <div className="w-[42%] space-y-2">
                {bands.map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-mun-slate"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} /> {b.label}</span>
                    <span className="tnum font-semibold text-mun-ink">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/[0.05] pt-2 text-[11px] text-mun-grey">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={13} /> Confidence:</span>
            {confCounts.map(({ c, n }) => (
              <span key={c} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONFIDENCE_COLOR[c] }} /> {c} <span className="tnum font-semibold text-mun-ink">{n}</span></span>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Layers} title="Richest sectors" subtitle="Where the new promoter wealth is concentrated" accent={MUN.emerald} />
          {sectorBars.length ? <HBars data={sectorBars} format={(n) => fmtCr(n)} labelWidth={160} barSize={22} showAxis /> : <Empty />}
          {states.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-black/[0.05] pt-2">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-mun-grey"><MapPin size={13} /> Top states:</span>
              {states.slice(0, 6).map((st) => <Badge key={st} color={MUN.cyan}>{st}</Badge>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-[12.5px] text-mun-grey">Not enough qualifying people yet.</p>;
}
