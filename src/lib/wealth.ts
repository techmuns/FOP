// Browser-side wealth engine — mirrors scripts/lib/wealth.mjs. KEEP IN SYNC.
// Used for the live "Refresh" recompute and for chart aggregations in the tabs.
import type { IPO, Prospect, Confidence, ProspectCompany } from '../types';
import { wealthBand, WEALTH_BANDS } from './brand';

export const GATE_CR = 150;

const HONORIFICS = /^(?:m\/s|mr|mrs|ms|dr|prof|shri|sri|smt|late|col|capt|maj|justice|sardar|thiru)\.?\s+/i;
const ENTITY_RE =
  /\b(?:huf|trust|llp|llc|inc|pvt|private|ltd|limited|holdings?|ventures?|capital|industries|enterprises?|investments?|infra|finvest|securities|group|foundation|systems|technologies|overseas|exports?|impex|trading|estates?|realty|properties|developers?|mercantile|commercial|consultancy|consultants|associates|partners|and sons|& sons|family)\b/i;

export function normalizeName(raw: string): { key: string; display: string; isEntity: boolean } {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  while (HONORIFICS.test(s)) s = s.replace(HONORIFICS, '');
  s = s.replace(/\s+/g, ' ').trim();
  const isEntity = ENTITY_RE.test(s);
  const key = s.toLowerCase().replace(/[.,'"`]/g, '').replace(/\s+/g, ' ').trim();
  return { key: key || s.toLowerCase(), display: titleCase(s), isEntity };
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => {
      if (!w) return w;
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      if (/^[A-Z]\.?$/.test(w)) return w;
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

const round = (n: number | null | undefined, d = 2): number | null =>
  n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d;

const CONF_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
function weakest(a: Confidence | null, b: Confidence): Confidence {
  if (!a) return b;
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

export function computeCompanyWealth(ipo: IPO): IPO {
  let pct = ipo.current_promoter_pct;
  if (pct == null) pct = ipo.post_promoter_pct;
  const mcap = ipo.market_cap_cr;
  ipo.holding_value_cr = pct != null && mcap != null ? round((pct / 100) * mcap) : null;
  const sellers = ipo.promoters || [];
  const hasOfs = sellers.some((p) => p.is_promoter && p.ofs_cr != null);
  ipo.promoter_ofs_cash_cr = hasOfs
    ? round(sellers.filter((p) => p.is_promoter && p.ofs_cr != null).reduce((s, p) => s + (p.ofs_cr || 0), 0))
    : null;
  ipo.company_promoter_wealth_cr = round((ipo.holding_value_cr || 0) + (ipo.promoter_ofs_cash_cr || 0)) || null;
  return ipo;
}

/** Apply live prices (marketCap in ₹ crore) to IPOs and recompute holdings. */
export function recomputeHoldings(ipos: IPO[], prices: Record<string, { current?: number; marketCap?: number }>): IPO[] {
  return ipos.map((ipo) => {
    const next = { ...ipo };
    const live = ipo.ticker ? prices[ipo.ticker] : undefined;
    if (live?.marketCap != null && isFinite(live.marketCap)) {
      next.market_cap_cr = round(live.marketCap);
      next.data_flags = { ...(ipo.data_flags || {}), market_cap: 'munshot-live' };
    }
    return computeCompanyWealth(next);
  });
}

export function rollUpProspects(ipos: IPO[]): Prospect[] {
  type Acc = {
    person: string;
    displays: Set<string>;
    companies: ProspectCompany[];
    ofs: number;
    hold: number;
    city: string | null;
    state: string | null;
    sectors: Set<string>;
    pledge: number | null;
    confidence: Confidence | null;
    latest: string | null;
  };
  const people = new Map<string, Acc>();
  const touch = (key: string, display: string): Acc => {
    let p = people.get(key);
    if (!p) {
      p = {
        person: display,
        displays: new Set([display]),
        companies: [],
        ofs: 0,
        hold: 0,
        city: null,
        state: null,
        sectors: new Set(),
        pledge: null,
        confidence: null,
        latest: null,
      };
      people.set(key, p);
    }
    p.displays.add(display);
    return p;
  };

  for (const ipo of ipos) {
    computeCompanyWealth(ipo);
    const sellers = (ipo.promoters || []).filter((s) => s.is_promoter);
    const norms = sellers.map((s) => ({ ...normalizeName(s.name), seller: s }));
    const individuals = norms.filter((n) => !n.isEntity);
    const entities = norms.filter((n) => n.isEntity);
    let holders = individuals.length ? individuals : entities;
    let holdingConfidence: Confidence = 'HIGH';
    if (individuals.length === 1) holdingConfidence = 'HIGH';
    else if (individuals.length > 1) holdingConfidence = 'LOW';
    else if (entities.length === 1) holdingConfidence = 'MEDIUM';
    else if (entities.length > 1) holdingConfidence = 'LOW';
    const holdingEach = holders.length && ipo.holding_value_cr != null ? ipo.holding_value_cr / holders.length : null;

    for (const n of norms) {
      const p = touch(n.key, n.display);
      const ofsCr = n.seller.ofs_cr != null ? round(n.seller.ofs_cr) : null;
      const isHolder = holders.some((h) => h.key === n.key);
      const holdCr = isHolder ? round(holdingEach) : null;
      p.companies.push({
        company: ipo.company,
        ticker: ipo.ticker || null,
        role: (n.seller as { category?: string }).category
          ? titleCase(String((n.seller as { category?: string }).category))
          : n.isEntity
            ? 'Promoter Group'
            : 'Promoter',
        holding_value_cr: holdCr,
        ofs_cash_cr: ofsCr,
      });
      if (ofsCr) p.ofs += ofsCr;
      if (holdCr != null) {
        p.hold += holdCr;
        p.confidence = weakest(p.confidence, holdingConfidence);
      }
      if (ipo.sector) p.sectors.add(ipo.sector);
      if (ipo.pledge_pct != null) p.pledge = Math.max(p.pledge ?? 0, ipo.pledge_pct);
      if (newer(ipo.listing_date, p.latest)) {
        p.latest = ipo.listing_date || p.latest;
        if (ipo.city) p.city = ipo.city;
        if (ipo.state) p.state = ipo.state;
      }
      if (!p.city && ipo.city) p.city = ipo.city;
      if (!p.state && ipo.state) p.state = ipo.state;
    }
  }

  const out: Prospect[] = [];
  for (const p of people.values()) {
    const est = round(p.ofs + p.hold) || 0;
    out.push({
      person: [...p.displays].sort((a, b) => b.length - a.length)[0],
      companies: p.companies,
      est_wealth_cr: est,
      ofs_cash_cr: round(p.ofs) || 0,
      holding_value_cr: round(p.hold) || 0,
      city: p.city,
      state: p.state,
      sectors: [...p.sectors],
      max_pledge_pct: p.pledge != null ? round(p.pledge, 1) : null,
      confidence: p.confidence || 'HIGH',
      latest_listing_date: p.latest,
      qualifies: est >= GATE_CR,
    });
  }
  return out
    .filter((p) => p.est_wealth_cr >= GATE_CR)
    .sort((a, b) => b.ofs_cash_cr - a.ofs_cash_cr || b.est_wealth_cr - a.est_wealth_cr);
}

function newer(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

// ---- Aggregations for charts ----------------------------------------------

export function summary(prospects: Prospect[]) {
  const qualifying = prospects.filter((p) => p.qualifies);
  return {
    count: prospects.length,
    qualifying: qualifying.length,
    totalWealthCr: round(prospects.reduce((s, p) => s + p.est_wealth_cr, 0)) || 0,
    totalOfsCr: round(prospects.reduce((s, p) => s + p.ofs_cash_cr, 0)) || 0,
    totalHoldingCr: round(prospects.reduce((s, p) => s + p.holding_value_cr, 0)) || 0,
  };
}

export function prospectsByBand(prospects: Prospect[]) {
  return WEALTH_BANDS.map((b) => {
    const members = prospects.filter((p) => wealthBand(p.est_wealth_cr).key === b.key);
    return {
      key: b.key,
      label: b.label,
      color: b.color,
      count: members.length,
      totalCr: round(members.reduce((s, p) => s + p.est_wealth_cr, 0)) || 0,
    };
  });
}

export function sectorTotals(prospects: Prospect[]) {
  const m = new Map<string, number>();
  for (const p of prospects) {
    const w = p.est_wealth_cr / Math.max(1, p.sectors.length);
    for (const s of p.sectors.length ? p.sectors : ['Unclassified']) m.set(s, (m.get(s) || 0) + w);
  }
  return [...m.entries()].map(([sector, cr]) => ({ sector, cr: round(cr) || 0 })).sort((a, b) => b.cr - a.cr);
}
