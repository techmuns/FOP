import { useState } from 'react';
import { Target, Banknote, Wallet, Users } from 'lucide-react';
import type { AppData } from '../types';
import { PageHeader, Card, CardHeader, MiniStat, Badge } from '../components/ui/Card';
import { Segmented } from '../components/ui/Controls';
import { StackedBar } from '../components/charts/StackedBar';
import { HBars, type HBarDatum } from '../components/charts/Bars';
import { fmtCr } from '../lib/format';
import { summary } from '../lib/wealth';
import { wealthBandColor, WEALTH_BANDS, MONEY, CONFIDENCE_COLOR } from '../lib/brand';
import { SoonNote } from './SoonNote';

export function HitListTab({ data }: { data: AppData }) {
  const [metric, setMetric] = useState<'ofs' | 'wealth'>('ofs');
  const prospects = data.prospects.filter((p) => p.qualifies);
  const s = summary(prospects);

  const top = [...prospects]
    .sort((a, b) => (metric === 'ofs' ? b.ofs_cash_cr - a.ofs_cash_cr : b.est_wealth_cr - a.est_wealth_cr))
    .slice(0, 8);

  const bars: HBarDatum[] = top.map((p) => ({
    key: p.person,
    label: p.person,
    value: metric === 'ofs' ? p.ofs_cash_cr : p.est_wealth_cr,
    color: wealthBandColor(p.est_wealth_cr),
    valueLabel: fmtCr(metric === 'ofs' ? p.ofs_cash_cr : p.est_wealth_cr),
    sublabel: [p.city, p.state].filter(Boolean).join(', ') || p.sectors.slice(0, 2).join(', '),
    tipRows: [
      { label: 'Est. wealth', value: fmtCr(p.est_wealth_cr), color: MONEY.wealth },
      { label: 'Cash out (OFS)', value: fmtCr(p.ofs_cash_cr), color: MONEY.ofs },
      { label: 'Still held', value: fmtCr(p.holding_value_cr), color: MONEY.holding },
      { label: 'Confidence', value: p.confidence, color: CONFIDENCE_COLOR[p.confidence] },
    ],
    note: `${p.companies.length} IPO${p.companies.length > 1 ? 's' : ''}${p.sectors.length ? ' · ' + p.sectors.slice(0, 2).join(', ') : ''}`,
  }));

  const moneySplit = [
    { key: 'ofs', label: 'Cash already taken out (OFS)', value: s.totalOfsCr, color: MONEY.ofs },
    { key: 'hold', label: 'Paper wealth still held', value: s.totalHoldingCr, color: MONEY.holding },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        icon={Target}
        title="Hit-List"
        subtitle={
          prospects.length
            ? `${prospects.length} qualifying prospects — about ${fmtCr(s.totalWealthCr)} of freshly-minted wealth in view`
            : 'The ranked prospect list appears once qualifying promoters are found.'
        }
        right={
          <Segmented
            value={metric}
            onChange={(v) => setMetric(v as 'ofs' | 'wealth')}
            options={[
              { value: 'ofs', label: 'By cash out' },
              { value: 'wealth', label: 'By total wealth' },
            ]}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Qualifying targets" value={prospects.length} sub="≥ ₹150 Cr estimated wealth" color={MONEY.wealth} />
        <MiniStat label="Total est. wealth" value={fmtCr(s.totalWealthCr)} sub="across all qualifying people" color={MONEY.wealth} />
        <MiniStat label="Cash out (OFS)" value={fmtCr(s.totalOfsCr)} sub="high-confidence, from OFS tables" color={MONEY.ofs} />
        <MiniStat label="Still held" value={fmtCr(s.totalHoldingCr)} sub="paper wealth in listed stock" color={MONEY.holding} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            icon={Banknote}
            title={metric === 'ofs' ? 'Biggest cash-outs' : 'Wealthiest targets'}
            subtitle={`Top ${bars.length} people by ${metric === 'ofs' ? 'cash taken out via Offer-for-Sale' : 'total estimated wealth'} · hover for the breakdown`}
            accent={MONEY.wealth}
          />
          {bars.length ? (
            <HBars data={bars} format={(n) => fmtCr(n)} labelWidth={168} barSize={24} tipTitlePrefix="" />
          ) : (
            <EmptyHint />
          )}
          <Legend />
        </Card>

        <Card>
          <CardHeader icon={Wallet} title="Where the money is" subtitle="Cash already out vs wealth still on paper" accent={MONEY.ofs} />
          {s.totalWealthCr > 0 ? (
            <>
              <div className="mb-2">
                <StackedBar segments={moneySplit} format={(n) => fmtCr(n)} height={46} />
              </div>
              <div className="space-y-1.5">
                {moneySplit.map((m) => (
                  <div key={m.key} className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-1.5 text-mun-slate">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: m.color }} />
                      {m.label}
                    </span>
                    <span className="tnum font-semibold text-mun-ink">{fmtCr(m.value)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11.5px] text-mun-grey">
                <Users size={14} /> {data.meta.counts.prospects} people detected · {prospects.length} clear the ₹150 Cr bar
              </div>
            </>
          ) : (
            <EmptyHint />
          )}
        </Card>
      </div>

      <SoonNote
        title="Next: the full ranked hit-list"
        body="Sortable, filterable table of every qualifying person — wealth band, city/state, sectors, pledge risk, company trail and a confidence flag — with CSV export. This preview proves the data pipeline and chart kit are live."
      />
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/[0.05] pt-2 text-[11px] text-mun-grey">
      <span className="font-medium">Wealth band:</span>
      {WEALTH_BANDS.map((b) => (
        <span key={b.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
          {b.label}
        </span>
      ))}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="grid place-items-center gap-2 py-10 text-center">
      <Badge color="#64748B">No qualifying prospects in this sample yet</Badge>
      <p className="max-w-sm text-[12.5px] text-mun-grey">
        The seeded sample may not include ₹150 Cr+ sellers. Re-run the backfill (all IPOs) to populate the hit-list.
      </p>
    </div>
  );
}
