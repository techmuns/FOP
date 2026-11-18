// Domain types for Munshot — IPO Promoter Wealth Radar.
// These mirror the JSON schemas committed under public/data/.

export type Exchange = 'NSE' | 'BSE' | 'NSE SME' | 'BSE SME';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** One row of an IPO's Offer-for-Sale table (per selling shareholder). */
export interface PromoterSeller {
  name: string;
  is_promoter: boolean;
  ofs_shares: number | null;
  ofs_cr: number | null;
}

/** One IPO record (immutable once listed). All *_cr fields are in ₹ crore. */
export interface IPO {
  id: string;
  company: string;
  ticker: string | null;
  exchange: Exchange;
  listing_date: string | null;
  issue_price_low: number | null;
  issue_price_high: number | null;
  issue_size_cr: number | null;
  fresh_cr: number | null;
  ofs_cr: number | null;
  pre_promoter_pct: number | null;
  post_promoter_pct: number | null;
  current_promoter_pct: number | null;
  pledge_pct: number | null;
  market_cap_cr: number | null;
  /** at-offer market cap from the prospectus — a flagged fallback when there's no live cap */
  offer_market_cap_cr: number | null;
  current_price: number | null;
  sector: string | null;
  city: string | null;
  state: string | null;
  promoters: PromoterSeller[];
  holding_value_cr: number | null;
  promoter_ofs_cash_cr: number | null;
  company_promoter_wealth_cr: number | null;
  source_url: string;
  scraped_at: string;
  /** which figures are real vs fallback — e.g. { market_cap: 'screener', current_promoter_pct: 'post_issue' } */
  data_flags?: Record<string, string>;
}

/** A company a prospect is tied to, with that company's contribution to their wealth. */
export interface ProspectCompany {
  company: string;
  ticker: string | null;
  role: string;
  exchange: Exchange;
  listing_date: string | null;
  sector: string | null;
  holding_value_cr: number | null;
  ofs_cash_cr: number | null;
}

/** A person-level prospect — the hit-list unit. */
export interface Prospect {
  person: string;
  companies: ProspectCompany[];
  est_wealth_cr: number;
  ofs_cash_cr: number;
  holding_value_cr: number;
  city: string | null;
  state: string | null;
  sectors: string[];
  max_pledge_pct: number | null;
  confidence: Confidence;
  latest_listing_date: string | null;
  qualifies: boolean;
}

export interface DataSource {
  name: string;
  url: string;
  /** 'real' | 'partial' | 'blocked' | 'seeded' */
  status: string;
  note?: string;
}

export interface Meta {
  generated_at: string;
  universe: { mainboard: number; sme: number; years: number[] };
  counts: {
    ipos: number;
    ipos_detailed?: number;
    prospects: number;
    qualifying: number;
    thresholds?: Record<string, number>;
  };
  data_sources: DataSource[];
  /** in-session provenance: what is real vs seeded, and anything that blocked */
  seeding?: { mode: string; real: string[]; blocked: string[]; notes?: string[] };
}

/** The full data bundle the app loads. */
export interface AppData {
  ipos: IPO[];
  prospects: Prospect[];
  meta: Meta;
}
