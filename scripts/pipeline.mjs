/**
 * Munshot data pipeline — builds public/data/{ipos,prospects,meta}.json.
 *
 *   node scripts/pipeline.mjs seed      # in-session / quick: capped universe + ~50 detail deep-scrapes
 *   node scripts/pipeline.mjs backfill  # full 3-year universe + every detail page (GitHub Actions)
 *   node scripts/pipeline.mjs refresh   # re-pull live prices + promoter%, pick up new IPOs, recompute
 *
 * Sources: Chittorgarh (universe + promoter/OFS), Screener.in (today's promoter%/pledge/mcap),
 * Munshot API (live price/mcap). All FREE. Nothing is fabricated — missing figures stay null
 * and every record carries provenance flags + a scraped_at stamp.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO, todayISO, round, sleep, closePlaywright } from './lib/http.mjs';
import { collectUniverse, scrapeDetail } from './lib/chittorgarh.mjs';
import { fetchScreener } from './lib/screener.mjs';
import { fetchForTicker } from './lib/munshot.mjs';
import { computeCompanyWealth, rollUpProspects } from './lib/wealth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const MODE = (process.argv[2] || 'seed').toLowerCase();

const envInt = (k, d) => (process.env[k] ? parseInt(process.env[k], 10) : d);

/** An explicit crawl plan: which { segment, financial-year, page-cap } steps to fetch. */
function buildPlan(mode) {
  const mb = envInt('MB_PAGES', mode === 'backfill' ? 400 : 40);
  const sme = envInt('SME_PAGES', mode === 'backfill' ? 400 : 40);
  const step = (segment, maxPages) => (fy) => ({ segment, fy, maxPages });
  if (mode === 'backfill') {
    const fys = ['2026-27', '2025-26', '2024-25', '2023-24', '2022-23'];
    return [...fys.map(step('mainboard', mb)), ...fys.map(step('sme', sme))];
  }
  if (mode === 'refresh') {
    const fys = ['2026-27', '2025-26'];
    return [...fys.map(step('mainboard', mb)), ...fys.map(step('sme', sme))];
  }
  // seed: all mainboard years + the two most recent SME years (SME volume is large)
  return [
    ...['2026-27', '2025-26', '2024-25', '2023-24'].map(step('mainboard', mb)),
    ...['2026-27', '2025-26'].map(step('sme', sme)),
  ];
}
const DETAIL_SAMPLE = envInt('DETAIL_SAMPLE', MODE === 'backfill' ? 100000 : MODE === 'refresh' ? 60 : 50);
const POLITE_MS = envInt('POLITE_MS', MODE === 'backfill' ? 1200 : 900);

const TARGET_YEARS = [2023, 2024, 2025, 2026];
const log = (m) => console.log(m);

function inTargetYears(row) {
  if (!row.listing_date) return true; // keep not-yet-listed (upcoming) rows
  const y = new Date(row.listing_date).getUTCFullYear();
  return TARGET_YEARS.includes(y) || y > TARGET_YEARS[TARGET_YEARS.length - 1];
}

/** Pick ~N recent detail targets, prioritising IPOs with an OFS (they yield prospects), mixed MB/SME. */
function pickDetailTargets(rows, N) {
  const score = (r) => ({ r, hasOfs: (r.ofs_cr || 0) > 0 ? 1 : 0, t: r.listing_date ? Date.parse(r.listing_date) : 0 });
  const by = (a, b) => b.hasOfs - a.hasOfs || b.t - a.t;
  const mb = rows.filter((r) => r.segment === 'mainboard').map(score).sort(by);
  const sme = rows.filter((r) => r.segment === 'sme').map(score).sort(by);
  const nMb = Math.round(N * 0.68);
  const picked = [...mb.slice(0, nMb), ...sme.slice(0, N - nMb)].map((x) => x.r);
  if (picked.length < N) {
    const rest = [...mb.slice(nMb), ...sme.slice(N - nMb)].sort(by).map((x) => x.r);
    picked.push(...rest.slice(0, N - picked.length));
  }
  return picked.slice(0, N);
}

function listRowToIpo(row) {
  // minimal IPO record for universe members we didn't deep-scrape
  return {
    id: row.id,
    company: row.company,
    ticker: null,
    exchange: row.exchange,
    listing_date: row.listing_date,
    issue_price_low: row.issue_price_low,
    issue_price_high: row.issue_price_high,
    issue_size_cr: row.issue_size_cr,
    fresh_cr: row.fresh_cr,
    ofs_cr: row.ofs_cr,
    pre_promoter_pct: null,
    post_promoter_pct: null,
    current_promoter_pct: null,
    pledge_pct: null,
    market_cap_cr: null,
    offer_market_cap_cr: null,
    sector: null,
    city: null,
    state: null,
    promoters: [],
    holding_value_cr: null,
    promoter_ofs_cash_cr: null,
    company_promoter_wealth_cr: null,
    source_url: row.source_url,
    scraped_at: nowISO(),
    data_flags: { detail: 'list-only' },
  };
}

/** Enrich one listed IPO with live price (Munshot) + promoter%/pledge/mcap (Screener). */
async function enrich(ipo, { politeMs, provenance }) {
  if (!ipo.ticker) return;
  const listed = !ipo.listing_date || new Date(ipo.listing_date).getTime() <= Date.now();
  if (!listed) return;

  // Screener (promoter %, pledge, market cap)
  const scr = await fetchScreener([ipo.ticker], { politeMs, log }).catch(() => null);
  if (scr) {
    provenance.screener++;
    if (scr.promoterPct != null) {
      ipo.current_promoter_pct = scr.promoterPct;
      ipo.data_flags.current_promoter_pct = 'screener';
    }
    if (scr.pledgePct != null) {
      ipo.pledge_pct = scr.pledgePct;
      ipo.data_flags.pledge_pct = 'screener';
    }
    if (scr.marketCapCr != null) {
      ipo.market_cap_cr = scr.marketCapCr;
      ipo.data_flags.market_cap = 'screener';
    }
  }

  // Munshot (live price + market cap) — preferred for market cap when available
  const mun = await fetchForTicker(ipo.ticker, { politeMs: 0, log }).catch(() => null);
  if (mun) {
    provenance.munshot++;
    if (mun.marketCapCr != null) {
      ipo.market_cap_cr = mun.marketCapCr;
      ipo.data_flags.market_cap = 'munshot-live';
    }
  } else {
    provenance.munshotFail++;
  }

  // last-resort market cap: at-offer valuation from the prospectus (clearly flagged)
  if (ipo.market_cap_cr == null && ipo.offer_market_cap_cr != null) {
    ipo.market_cap_cr = ipo.offer_market_cap_cr;
    ipo.data_flags.market_cap = 'offer';
  }
  await sleep(politeMs);
}

function writeData(ipos, prospects, meta) {
  mkdirSync(DATA, { recursive: true });
  // compute wealth on every record before writing
  ipos.forEach(computeCompanyWealth);
  writeFileSync(path.join(DATA, 'ipos.json'), JSON.stringify(ipos, null, 2));
  writeFileSync(path.join(DATA, 'prospects.json'), JSON.stringify(prospects, null, 2));
  writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2));
}

async function run() {
  const plan = buildPlan(MODE);
  const started = Date.now();
  log(`\n▶ Munshot pipeline — mode=${MODE}\n`);

  const provenance = { screener: 0, munshot: 0, munshotFail: 0, detailOk: 0, detailFail: 0 };
  const blocked = [];

  // ---- existing data (for refresh / incremental) ----
  const existing = MODE === 'refresh' && existsSync(path.join(DATA, 'ipos.json'))
    ? JSON.parse(readFileSync(path.join(DATA, 'ipos.json'), 'utf8'))
    : [];
  const existingById = new Map(existing.map((i) => [i.id, i]));

  // ---- 1. universe (list) ----
  log('① Collecting IPO universe from Chittorgarh…');
  const { rows: allRows, perSegment } = await collectUniverse({ plan, politeMs: POLITE_MS, log });
  const universe = allRows.filter(inTargetYears);
  log(`   universe: ${universe.length} IPOs (${perSegment.mainboard || 0} mainboard rows, ${perSegment.sme || 0} sme rows fetched)\n`);

  // ---- 2. choose detail targets ----
  let targets;
  if (MODE === 'refresh') {
    // only NEW IPOs we haven't detailed before + currently-upcoming ones
    const fresh = universe.filter((r) => !existingById.has(r.id));
    targets = pickDetailTargets(fresh, DETAIL_SAMPLE);
    log(`② Refresh: ${fresh.length} new IPOs; deep-scraping ${targets.length}.`);
  } else {
    targets = pickDetailTargets(universe, DETAIL_SAMPLE);
    log(`② Deep-scraping ${targets.length} detail pages (recent, OFS-weighted, MB/SME mix)…`);
  }
  const targetIds = new Set(targets.map((t) => t.id));

  // ---- 3. deep-scrape details ----
  const detailed = new Map();
  for (const row of targets) {
    const rec = await scrapeDetail(row, { politeMs: POLITE_MS, log });
    if (rec) {
      detailed.set(rec.id, rec);
      provenance.detailOk++;
    } else {
      provenance.detailFail++;
      blocked.push(`detail ${row.slug}`);
    }
  }
  log(`   detailed ok=${provenance.detailOk} fail=${provenance.detailFail}\n`);

  // ---- 4. assemble the IPO set ----
  const ipos = universe.map((row) => {
    if (detailed.has(row.id)) return detailed.get(row.id);
    if (MODE === 'refresh' && existingById.has(row.id)) return existingById.get(row.id);
    return listRowToIpo(row);
  });
  // carry forward any previously-detailed IPOs that fell outside this run's universe window
  if (MODE === 'refresh') {
    for (const prev of existing) if (!ipos.some((i) => i.id === prev.id)) ipos.push(prev);
  }

  // ---- 5. enrich listed, detailed IPOs with live data ----
  // (bounded by ENRICH_CAP so a full backfill stays inside CI time limits; older names
  //  fall back to the at-offer market cap, and the weekly refresh tops everyone up over time.)
  const ENRICH_CAP = envInt('ENRICH_CAP', MODE === 'backfill' ? 250 : 100000);
  let toEnrich = ipos.filter((i) => i.ticker && (targetIds.has(i.id) || MODE === 'refresh'));
  if (ENRICH_CAP <= 0) toEnrich = [];
  else if (toEnrich.length > ENRICH_CAP) {
    toEnrich = [...toEnrich]
      .sort((a, b) => (Date.parse(b.listing_date || 0) || 0) - (Date.parse(a.listing_date || 0) || 0))
      .slice(0, ENRICH_CAP);
  }
  log(`③ Enriching ${toEnrich.length} listed names (Screener + Munshot live)…`);
  for (const ipo of toEnrich) await enrich(ipo, { politeMs: POLITE_MS, provenance });
  if (provenance.munshot === 0 && provenance.munshotFail > 0) blocked.push('Munshot live API (HTTP 502 / unreachable)');
  log(`   screener hits=${provenance.screener} · munshot hits=${provenance.munshot} (fail=${provenance.munshotFail})\n`);

  // ---- 6. wealth + prospects ----
  ipos.forEach(computeCompanyWealth);
  const prospects = rollUpProspects(ipos);
  const qualifying = prospects.filter((p) => p.qualifies);
  log(`④ Wealth engine: ${prospects.length} prospects, ${qualifying.length} qualifying ≥₹150 Cr\n`);

  // ---- 7. meta + provenance ----
  const real = [];
  if (provenance.detailOk > 0) real.push(`Chittorgarh universe + promoter/OFS disclosures (${provenance.detailOk} detail pages)`);
  if (provenance.screener > 0) real.push(`Screener.in promoter% / pledge / market cap (${provenance.screener} companies)`);
  if (provenance.munshot > 0) real.push(`Munshot live price / market cap (${provenance.munshot} tickers)`);

  const meta = {
    generated_at: nowISO(),
    mode: MODE,
    universe: {
      mainboard: ipos.filter((i) => i.exchange === 'NSE' || i.exchange === 'BSE').length,
      sme: ipos.filter((i) => String(i.exchange).includes('SME')).length,
      years: TARGET_YEARS,
    },
    counts: { ipos: ipos.length, prospects: prospects.length, qualifying: qualifying.length },
    data_sources: [
      { name: 'Chittorgarh', url: 'https://www.chittorgarh.com', status: provenance.detailOk > 0 ? 'real' : 'partial', note: 'IPO universe, promoters, pre/post shareholding %, Offer-for-Sale per-seller table' },
      { name: 'Screener.in', url: 'https://www.screener.in', status: provenance.screener > 0 ? 'real' : 'blocked', note: "Today's promoter holding %, pledged %, market cap" },
      { name: 'Munshot API', url: 'https://fastapi.muns.io/stock-data', status: provenance.munshot > 0 ? 'real' : 'blocked', note: 'Live price & market cap' },
    ],
    seeding: {
      mode: MODE,
      real,
      blocked: [...new Set(blocked.filter((b) => !b.startsWith('detail ')))],
      notes: [
        `${provenance.detailOk} IPOs deep-scraped for promoter/OFS; ${ipos.length - provenance.detailOk} list-level only.`,
        `Market cap source per IPO is flagged in data_flags (munshot-live / screener / offer).`,
      ],
    },
    took_seconds: Math.round((Date.now() - started) / 1000),
  };

  writeData(ipos, prospects, meta);

  log('✓ wrote public/data/ipos.json, prospects.json, meta.json');
  log(`  IPOs: ${meta.counts.ipos}  ·  prospects: ${meta.counts.prospects}  ·  qualifying ≥₹150 Cr: ${meta.counts.qualifying}`);
  log(`  real sources: ${real.join('; ') || '(none)'}`);
  log(`  blocked: ${meta.seeding.blocked.join('; ') || '(none)'}`);
  log(`  took ${meta.took_seconds}s`);
}

run()
  .catch((e) => {
    console.error('\n✗ pipeline failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePlaywright();
  });
