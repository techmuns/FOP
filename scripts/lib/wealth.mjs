/**
 * Munshot wealth + person-aggregation engine (canonical, used by the pipeline).
 *
 * Mirrored in src/lib/wealth.ts for the browser (live "Refresh"). KEEP THE TWO IN SYNC.
 *
 * Money convention: every *_cr field is in ₹ crore.
 * Core identities (per IPO company):
 *   holding_value_cr       = (current_promoter_pct/100) * market_cap_cr        (paper wealth today)
 *   promoter_ofs_cash_cr   = Σ over OFS rows where seller is a promoter of ofs_cr
 *   company_promoter_wealth_cr = holding_value_cr + promoter_ofs_cash_cr
 *
 * Person roll-up: OFS cash is per-named-seller (HIGH confidence). Group holding value
 * is disclosed at the promoter-GROUP level, so we attribute it to the named promoter(s)
 * and flag confidence — HIGH (single named promoter), MEDIUM (single named group vehicle),
 * LOW (split across several named promoters). We never present an assumption as precise.
 */

export const GATE_CR = 150; // ideal-customer "qualifies" flag: ₹150 crore
export const FLOOR_CR = 25; // keep everyone worth ≥ ₹25 crore in the file; the UI filters live

const HONORIFICS = /^(?:m\/s|mr|mrs|ms|dr|prof|shri|sri|smt|late|col|capt|maj|justice|sardar|thiru)\.?\s+/i;
const ENTITY_RE =
  /\b(?:huf|trust|llp|llc|inc|pvt|private|ltd|limited|holdings?|ventures?|capital|industries|enterprises?|investments?|infra|finvest|securities|group|foundation|systems|technologies|overseas|exports?|impex|trading|estates?|realty|properties|developers?|mercantile|commercial|consultancy|consultants|associates|partners|and sons|& sons|family)\b/i;

/** Normalize a promoter/seller name → { key (grouping id), display, isEntity }. */
export function normalizeName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // strip one or more leading honorifics
  while (HONORIFICS.test(s)) s = s.replace(HONORIFICS, '');
  s = s.replace(/\s+/g, ' ').trim();
  const isEntity = ENTITY_RE.test(s);
  const display = titleCase(s);
  const key = s
    .toLowerCase()
    .replace(/[.,'"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { key: key || display.toLowerCase(), display, isEntity };
}

function titleCase(s) {
  return String(s)
    .split(' ')
    .map((w) => {
      if (!w) return w;
      // keep short all-caps acronyms (HUF, LLP, GPL); title-case the rest
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      if (/^[A-Z]\.?$/.test(w)) return w;
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

const round = (n, d = 2) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const CONF_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
function weakest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

/**
 * Compute per-company wealth fields IN PLACE on an IPO record and return the record.
 * Uses current_promoter_pct (fallback post_promoter_pct) and market_cap_cr.
 */
export function computeCompanyWealth(ipo) {
  const flags = ipo.data_flags || (ipo.data_flags = {});

  let pct = ipo.current_promoter_pct;
  if (pct == null) {
    pct = ipo.post_promoter_pct;
    if (pct != null) flags.current_promoter_pct = 'post_issue';
  }

  // fall back to the at-offer valuation when there's no live (Screener/Munshot) market cap
  if (ipo.market_cap_cr == null && ipo.offer_market_cap_cr != null) {
    ipo.market_cap_cr = ipo.offer_market_cap_cr;
    flags.market_cap = 'offer';
  }

  const mcap = ipo.market_cap_cr;
  ipo.holding_value_cr = pct != null && mcap != null ? round((pct / 100) * mcap) : null;

  const sellers = Array.isArray(ipo.promoters) ? ipo.promoters : [];
  // normalise OFS cash to the task's formula: shares × issue_price_upper (self-heals any
  // record whose source table lacked the disclosed "Amount" column)
  for (const s of sellers) {
    if (s.ofs_shares != null && ipo.issue_price_high != null) {
      s.ofs_cr = round((s.ofs_shares * ipo.issue_price_high) / 1e7);
    }
  }
  const ofs = sellers
    .filter((p) => p.is_promoter && p.ofs_cr != null)
    .reduce((s, p) => s + p.ofs_cr, 0);
  ipo.promoter_ofs_cash_cr = sellers.some((p) => p.is_promoter && p.ofs_cr != null) ? round(ofs) : null;

  ipo.company_promoter_wealth_cr = round((ipo.holding_value_cr || 0) + (ipo.promoter_ofs_cash_cr || 0)) || null;
  return ipo;
}

/**
 * Roll IPOs up into person-level prospects.
 * @param {Array} ipos  IPO records (company wealth already computed, or will be computed here)
 * @param {{floorCr?: number, qualifyCr?: number}} opts  keep everyone >= floorCr; flag qualifies >= qualifyCr
 * @returns {Array} prospects, gated to >= floorCr, sorted by OFS cash desc.
 */
export function rollUpProspects(ipos, { floorCr = FLOOR_CR, qualifyCr = GATE_CR } = {}) {
  /** @type {Map<string, any>} */
  const people = new Map();

  const touch = (norm) => {
    if (!people.has(norm.key)) {
      people.set(norm.key, {
        person: norm.display,
        _displays: new Set([norm.display]),
        isEntity: norm.isEntity,
        companies: [],
        est_wealth_cr: 0,
        ofs_cash_cr: 0,
        holding_value_cr: 0,
        city: null,
        state: null,
        sectors: new Set(),
        max_pledge_pct: null,
        confidence: null,
        latest_listing_date: null,
      });
    }
    const p = people.get(norm.key);
    p._displays.add(norm.display);
    return p;
  };

  for (const ipo of ipos) {
    computeCompanyWealth(ipo);
    const sellers = (ipo.promoters || []).filter((s) => s.is_promoter);
    const sellerNorms = sellers.map((s) => ({ ...normalizeName(s.name), seller: s }));
    const namedIndividuals = sellerNorms.filter((n) => !n.isEntity);
    const namedEntities = sellerNorms.filter((n) => n.isEntity);

    // Who carries the group holding value, and with what confidence?
    let holders = [];
    let holdingConfidence = 'HIGH';
    if (namedIndividuals.length === 1) {
      holders = namedIndividuals;
      holdingConfidence = 'HIGH';
    } else if (namedIndividuals.length > 1) {
      holders = namedIndividuals;
      holdingConfidence = 'LOW'; // split assumed equally
    } else if (namedEntities.length === 1) {
      holders = namedEntities;
      holdingConfidence = 'MEDIUM'; // single named group vehicle
    } else if (namedEntities.length > 1) {
      holders = namedEntities;
      holdingConfidence = 'LOW';
    }
    const holdingEach = holders.length && ipo.holding_value_cr != null ? ipo.holding_value_cr / holders.length : null;

    // 1) OFS cash — exact per seller (HIGH).
    for (const n of sellerNorms) {
      const p = touch(n);
      const ofsCr = n.seller.ofs_cr != null ? round(n.seller.ofs_cr) : null;
      const isHolder = holders.some((h) => h.key === n.key);
      const holdCr = isHolder ? round(holdingEach) : null;
      p.companies.push({
        company: ipo.company,
        ticker: ipo.ticker || null,
        role: sellerRole(n.seller, n.isEntity),
        exchange: ipo.exchange,
        listing_date: ipo.listing_date || null,
        sector: ipo.sector || null,
        holding_value_cr: holdCr,
        ofs_cash_cr: ofsCr,
      });
      if (ofsCr) p.ofs_cash_cr += ofsCr;
      if (holdCr) {
        p.holding_value_cr += holdCr;
        p.confidence = weakest(p.confidence, holdingConfidence);
      }
      // bio bits
      if (ipo.sector) p.sectors.add(ipo.sector);
      if (ipo.pledge_pct != null) p.max_pledge_pct = Math.max(p.max_pledge_pct ?? 0, ipo.pledge_pct);
      if (isNewer(ipo.listing_date, p.latest_listing_date)) {
        p.latest_listing_date = ipo.listing_date || p.latest_listing_date;
        if (ipo.city) p.city = ipo.city;
        if (ipo.state) p.state = ipo.state;
      }
      if (!p.city && ipo.city) p.city = ipo.city;
      if (!p.state && ipo.state) p.state = ipo.state;
    }
  }

  const out = [];
  for (const p of people.values()) {
    p.est_wealth_cr = round(p.ofs_cash_cr + p.holding_value_cr) || 0;
    p.ofs_cash_cr = round(p.ofs_cash_cr) || 0;
    p.holding_value_cr = round(p.holding_value_cr) || 0;
    // choose the longest display variant as canonical
    p.person = [...p._displays].sort((a, b) => b.length - a.length)[0];
    const confidence = p.confidence || 'HIGH'; // OFS-only prospects are exact
    out.push({
      person: p.person,
      companies: p.companies,
      est_wealth_cr: p.est_wealth_cr,
      ofs_cash_cr: p.ofs_cash_cr,
      holding_value_cr: p.holding_value_cr,
      city: p.city,
      state: p.state,
      sectors: [...p.sectors],
      max_pledge_pct: p.max_pledge_pct != null ? round(p.max_pledge_pct, 1) : null,
      confidence,
      latest_listing_date: p.latest_listing_date,
      qualifies: p.est_wealth_cr >= qualifyCr,
    });
  }

  return out
    .filter((p) => p.est_wealth_cr >= floorCr)
    .sort((a, b) => b.ofs_cash_cr - a.ofs_cash_cr || b.est_wealth_cr - a.est_wealth_cr);
}

function sellerRole(seller, isEntity) {
  const cat = String(seller.category || '').trim();
  if (cat) return titleCase(cat);
  return isEntity ? 'Promoter Group' : 'Promoter';
}

function isNewer(a, b) {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}
