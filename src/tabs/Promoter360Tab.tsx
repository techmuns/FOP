import { UserSearch, PieChart, Layers, MapPin, ShieldCheck, X, Building2 } from 'lucide-react';
import type { AppData } from '../types';
import { PageHeader, Card, CardHeader, MiniStat, Badge } from '../components/ui/Card';
import { Donut, type DonutDatum } from '../components/charts/Donut';
import { HBars, type HBarDatum } from '../components/charts/Bars';
import { fmtCr, num } from '../lib/format';
import { prospectsByBand, sectorTotals, summary, normalizeName } from '../lib/wealth';
import { sectorColor, CONFIDENCE_COLOR, MUN } from '../lib/brand';

export function Promoter360Tab({
  data,
  focusPerson,
  onClearFocus,
}: {
  data: AppData;
  focusPerson?: string | null;
  onClearFocus?: () => void;
}) {
  const prospects = data.prospects.filter((p) => p.qualifies);
  const s = summary(prospects);
  const focusKey = focusPerson ? normalizeName(focusPerson).key : null;
  const focused = focusKey ? data.prospects.find((p) => normalizeName(p.person).key === focusKey) : null;
  const focusName = focused?.person ?? focusPerson;

  const bands = prospectsByBand(prospects).filter((b) => b.count > 0);
  const donut: DonutDatum[] = bands.map((b) => ({
    key: b.key,
    label: b.label,
    value: b.totalCr,
    color: b.color,
    note: `${b.count} ${b.count === 1 ? 'person' : 'people'} · ${fmtCr(b.totalCr)} combined`,
  }));

  const sectors = sectorTotals(prospects).slice(0, 7);
  const sectorBars: HBarDatum[] = sectors.map((x) => ({
    key: x.sector,
    label: x.sector,
    value: x.cr,
    color: sectorColor(x.sector),
    valueLabel: fmtCr(x.cr),
  }));

  const withHoldings = prospects.filter((p) => p.holding_value_cr > 0).length;
  const highConf = prospects.filter((p) => p.confidence === 'HIGH').length;
  const states = [...new Set(prospects.map((p) => p.state).filter(Boolean))];

  const confCounts = (['HIGH', 'MEDIUM', 'LOW'] as const).map((c) => ({
    c,
    n: prospects.filter((p) => p.confidence === c).length,
  }));

  return (
    <div className="animate-fade-up">
      {focusPerson && (
        <Card className="mb-4 border-mun-primary/30 bg-gradient-to-br from-mun-primary/[0.05] to-transparent">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[13px] font-bold text-white" style={{ background: focused ? CONFIDENCE_COLOR[focused.confidence] : MUN.grey }}>
                {(focusName || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-[17px] font-extrabold leading-tight text-mun-ink">{focusName}</h3>
                {focused ? (
                  <>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                      <span className="text-mun-grey">Est. wealth <b className="tnum text-mun-primary">{fmtCr(focused.est_wealth_cr)}</b></span>
                      <span className="text-mun-grey">Cash out <b className="tnum" style={{ color: MUN.amber }}>{fmtCr(focused.ofs_cash_cr)}</b></span>
                      <span className="text-mun-grey">Still held <b className="tnum" style={{ color: MUN.emerald }}>{fmtCr(focused.holding_value_cr)}</b></span>
                      <Badge color={CONFIDENCE_COLOR[focused.confidence]}>{focused.confidence}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Building2 size={13} className="text-mun-grey" />
                      {focused.companies.map((c, i) => (
                        <span key={i} className="rounded-md bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-mun-slate shadow-sm">
                          {c.company.replace(/\s+(Ltd\.?|Limited)\.?$/i, '')}
                        </span>
                      ))}
                      {(focused.city || focused.state) && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-mun-grey">
                          <MapPin size={12} /> {[focused.city, focused.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-[12.5px] text-mun-grey">Selected from the list — this person sits below the ₹25 Cr floor, so there's no full record yet.</p>
                )}
                <p className="mt-2 text-[11.5px] italic text-mun-grey">
                  Full 360 profile — company trail, cash-out timeline, residual stake, pledge risk & contactable geography — ships in the next release.
                </p>
              </div>
            </div>
            {onClearFocus && (
              <button onClick={onClearFocus} className="shrink-0 rounded-lg p-1.5 text-mun-grey transition hover:bg-white hover:text-mun-slate" title="Clear selection">
                <X size={16} />
              </button>
            )}
          </div>
        </Card>
      )}
      <PageHeader
        icon={UserSearch}
        title="Promoter 360"
        subtitle={`${num(data.meta.counts.prospects)} promoters de-anonymised from IPO disclosures — grouped per person, across every company they touch`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="People tracked" value={num(prospects.length)} sub="qualifying ≥ ₹150 Cr" color={MUN.primary} />
        <MiniStat label="With live holdings" value={num(withHoldings)} sub="paper wealth valued today" color={MUN.emerald} />
        <MiniStat label="High confidence" value={num(highConf)} sub="single promoter / exact OFS" color={MUN.emerald} />
        <MiniStat label="States covered" value={num(states.length)} sub="by registered office" color={MUN.cyan} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={PieChart} title="Wealth by band" subtitle="How the money splits across the three target tiers" accent={MUN.violet} />
          {donut.length ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Donut data={donut} format={(n) => fmtCr(n)} height={220} centerTitle="In view" centerValue={fmtCr(s.totalWealthCr)} thickness={30} />
              </div>
              <div className="w-[42%] space-y-2">
                {bands.map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-mun-slate">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
                      {b.label}
                    </span>
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
              <span key={c} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONFIDENCE_COLOR[c] }} />
                {c} <span className="tnum font-semibold text-mun-ink">{n}</span>
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Layers} title="Richest sectors" subtitle="Where the new promoter wealth is concentrated" accent={MUN.emerald} />
          {sectorBars.length ? (
            <HBars data={sectorBars} format={(n) => fmtCr(n)} labelWidth={150} barSize={22} showAxis />
          ) : (
            <Empty />
          )}
          {states.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-black/[0.05] pt-2">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-mun-grey">
                <MapPin size={13} /> Top states:
              </span>
              {states.slice(0, 6).map((st) => (
                <Badge key={st} color={MUN.cyan}>
                  {st}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-mun-primary/30 bg-mun-primary/[0.04] p-4">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mun-primary/10 text-mun-primary">
          <UserSearch size={16} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-bold text-mun-ink">Next: a profile page per promoter</h4>
            <span className="rounded-full bg-mun-amber/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-mun-amber-dark">Preview</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-mun-grey">
            Click any person to see their full company trail, cash-out timeline, residual stake, pledge risk and contactable registered-office geography — with the confidence basis spelled out.
          </p>
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-[12.5px] text-mun-grey">Not enough qualifying people in this sample yet — run the full backfill.</p>;
}
